use super::diff::{count_diff_stats, discover_diff};
use super::git::{git_cmd, should_skip_dir};
use super::validate::{validate_cwd, validate_session_id};
use crate::panel::types::{sessions_dir, DiffData, PanelData, ProjectDiff};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};

/// Per-session mutex to serialize panel.json writes.
static PANEL_LOCKS: std::sync::LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn panel_lock(session_id: &str) -> Arc<Mutex<()>> {
    let mut map = PANEL_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(session_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

#[tauri::command(async)]
pub fn get_panel_data(session_id: String) -> Result<Option<PanelData>, String> {
    validate_session_id(&session_id)?;
    let path = sessions_dir()?.join(&session_id).join("panel.json");
    // Same lock as the writer, and a missing file is "no data yet", not an error.
    let lock = panel_lock(&session_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let data: PanelData = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(Some(data))
}

/// Run diff discovery for a CWD. Supports both single-repo and multi-repo layouts.
///
/// If CWD is inside a git repo → discover diff for that repo.
/// If CWD is NOT a git repo → scan child directories for git repos,
/// collect diffs from all repos with changes (like sift's scanForRepos).
#[tauri::command(async)]
pub async fn refresh_panel(session_id: String, cwd: String) -> Result<Option<PanelData>, String> {
    validate_session_id(&session_id)?;
    validate_cwd(&cwd)?;
    let panel_path = sessions_dir()?.join(&session_id).join("panel.json");

    // Run blocking git operations on a dedicated thread to avoid starving
    // the async runtime.
    let sid_clone = session_id.clone();
    let cwd_clone = cwd.clone();
    let path_clone = panel_path.clone();
    tokio::task::spawn_blocking(move || {
        if let Ok(git_root) = git_cmd(&cwd_clone, &["rev-parse", "--show-toplevel"]) {
            if !git_root.is_empty() {
                build_panel_single(&sid_clone, &git_root, &path_clone)
            } else {
                build_panel_multi(&sid_clone, &cwd_clone, &path_clone)
            }
        } else {
            build_panel_multi(&sid_clone, &cwd_clone, &path_clone)
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Single repo: discover diff and build PanelData
fn build_panel_single(
    session_id: &str,
    git_root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, String> {
    let bundle = discover_diff(git_root);

    if bundle.full.is_empty() {
        // Write the cleared state rather than deleting the file: a deletion
        // raises no `panel-update`, so other sessions' badges kept showing the
        // changes after they were committed.
        let cleared = PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: git_root.to_string(),
            is_git: true,
            diff: None,
        };
        write_panel(session_id, &cleared, panel_path);
        return Ok(Some(cleared));
    }

    let (files_changed, lines_added, lines_removed) = count_diff_stats(&bundle.full);

    // Only populate local_* fields when local differs from full (i.e. full includes upstream/branch changes)
    let (local_raw, local_fc, local_la, local_lr) =
        if !bundle.local.is_empty() && bundle.local != bundle.full {
            let (fc, la, lr) = count_diff_stats(&bundle.local);
            (Some(bundle.local), Some(fc), Some(la), Some(lr))
        } else {
            (None, None, None, None)
        };

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: git_root.to_string(),
        is_git: true,
        diff: Some(DiffData {
            raw: bundle.full,
            files_changed,
            lines_added,
            lines_removed,
            projects: None,
            local_raw,
            local_files_changed: local_fc,
            local_lines_added: local_la,
            local_lines_removed: local_lr,
        }),
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// Multi-repo: scan child dirs for git repos, aggregate diffs from all that have changes
fn build_panel_multi(
    session_id: &str,
    root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, String> {
    let mut dir_entries: Vec<_> = match fs::read_dir(root) {
        Ok(e) => e.flatten().collect(),
        Err(_) => return Ok(None),
    };
    // Sort for deterministic ordering — fs::read_dir order is platform-dependent
    dir_entries.sort_by_key(|e| e.file_name());

    let mut all_diffs = Vec::new();
    let mut projects = Vec::new();
    let mut total_files: u32 = 0;
    let mut total_added: u32 = 0;
    let mut total_removed: u32 = 0;
    let mut found_any_repo = false;

    for entry in dir_entries {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }

        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let child_path = entry.path();
        let child_str = child_path.to_string_lossy().to_string();
        if should_skip_dir(&name_str) {
            continue;
        }

        if git_cmd(&child_str, &["rev-parse", "--show-toplevel"]).is_err() {
            continue;
        }

        found_any_repo = true;

        let bundle = discover_diff(&child_str);
        if bundle.full.is_empty() {
            continue;
        }

        let (fc, la, lr) = count_diff_stats(&bundle.full);
        total_files += fc;
        total_added += la;
        total_removed += lr;

        projects.push(ProjectDiff {
            name: name_str.to_string(),
            raw: bundle.full.clone(),
            files_changed: fc,
            lines_added: la,
            lines_removed: lr,
        });

        all_diffs.push(bundle.full);
    }

    if all_diffs.is_empty() {
        if !found_any_repo {
            let lock = panel_lock(session_id);
            let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            let _ = fs::remove_file(panel_path);
            return Ok(None);
        }
        let cleared = PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: root.to_string(),
            is_git: true,
            diff: None,
        };
        write_panel(session_id, &cleared, panel_path);
        return Ok(Some(cleared));
    }

    let combined = all_diffs.join("\n\n");
    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: root.to_string(),
        is_git: true,
        diff: Some(DiffData {
            raw: combined,
            files_changed: total_files,
            lines_added: total_added,
            lines_removed: total_removed,
            projects: Some(projects),
            local_raw: None,
            local_files_changed: None,
            local_lines_added: None,
            local_lines_removed: None,
        }),
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// Write `panel.json` for a session through a temp file and a rename, under the
/// session's lock. The file watcher and `get_panel_data` read it while a
/// refresh is writing; an in-place write would show them a truncated file.
fn write_panel(session_id: &str, data: &PanelData, panel_path: &std::path::Path) {
    let lock = panel_lock(session_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let Some(dir) = panel_path.parent() else {
        log::warn!("panel.json path has no parent: {}", panel_path.display());
        return;
    };
    if let Err(e) = fs::create_dir_all(dir) {
        log::warn!("Failed to create session dir: {}", e);
        return;
    }
    let json = match serde_json::to_string_pretty(data) {
        Ok(json) => json,
        Err(e) => {
            log::warn!("Failed to serialize panel data: {}", e);
            return;
        }
    };
    // Not `panel.json`, so the watcher never mistakes it for an update.
    let tmp = panel_path.with_extension("json.tmp");
    let written = fs::write(&tmp, json).and_then(|()| fs::rename(&tmp, panel_path));
    if let Err(e) = written {
        log::warn!("Failed to write panel.json: {}", e);
        let _ = fs::remove_file(&tmp);
    }
}

/// Delete a session's directory under its lock, so an in-flight write cannot
/// interleave with the removal.
fn remove_session_state(session_id: &str, dir: &std::path::Path) {
    let lock = PANEL_LOCKS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(session_id);
    let _guard = lock
        .as_ref()
        .map(|l| l.lock().unwrap_or_else(|e| e.into_inner()));
    if let Err(e) = fs::remove_dir_all(dir) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!("Failed to remove session dir {}: {}", dir.display(), e);
        }
    }
}

/// Free per-session state, in memory and on disk. Call when a PTY session is
/// terminated: nothing reads a closed session's `panel.json` again, and the
/// directories otherwise accumulate forever.
pub fn cleanup_session_analysis(session_id: &str) {
    // `session_id` arrives from the webview and is about to be joined onto a
    // path handed to `remove_dir_all`.
    if validate_session_id(session_id).is_err() {
        return;
    }
    match sessions_dir() {
        Ok(sessions) => remove_session_state(session_id, &sessions.join(session_id)),
        Err(e) => log::warn!("Failed to resolve sessions dir: {}", e),
    }
}

fn now_iso8601() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A panel.json written before the `plan` field was dropped still loads —
    /// serde ignores the unknown key, so no migration is needed.
    #[test]
    fn panel_data_ignores_legacy_plan_field() {
        let json = r#"{
            "version": 1,
            "timestamp": "2024-01-01T00:00:00Z",
            "cwd": "/tmp/test",
            "is_git": true,
            "plan": "Refactor the auth module"
        }"#;
        let parsed: PanelData = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.version, 1);
        assert!(parsed.diff.is_none());
    }

    use super::super::git::test_support::{commit_all, init_repo};

    fn panel_file(dir: &std::path::Path) -> std::path::PathBuf {
        dir.join("session").join("panel.json")
    }

    fn read_panel(path: &std::path::Path) -> PanelData {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn a_clean_tree_is_recorded_not_deleted() {
        let repo = init_repo();
        let dir = repo.path();
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        fs::write(dir.join("a.txt"), "two\n").unwrap();
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());
        let root = dir.to_str().unwrap();

        let dirty = build_panel_single("clean-tree", root, &panel)
            .unwrap()
            .unwrap();
        assert!(dirty.diff.is_some());
        assert!(read_panel(&panel).diff.is_some());

        commit_all(dir, "two");
        let clean = build_panel_single("clean-tree", root, &panel)
            .unwrap()
            .unwrap();
        assert!(clean.diff.is_none());
        // The file must survive so the watcher emits the clear.
        assert!(read_panel(&panel).diff.is_none());
    }

    #[test]
    fn a_clean_multi_repo_workspace_is_recorded_not_deleted() {
        let workspace = tempfile::tempdir().unwrap();
        let repo = workspace.path().join("proj");
        fs::create_dir(&repo).unwrap();
        super::super::git::test_support::git(&repo, &["init", "-q", "-b", "main"]);
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        fs::write(repo.join("a.txt"), "two\n").unwrap();
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());
        let root = workspace.path().to_str().unwrap();

        assert!(build_panel_multi("clean-multi", root, &panel)
            .unwrap()
            .unwrap()
            .diff
            .is_some());

        commit_all(&repo, "two");
        assert!(build_panel_multi("clean-multi", root, &panel)
            .unwrap()
            .unwrap()
            .diff
            .is_none());
        assert!(read_panel(&panel).diff.is_none());
    }

    #[test]
    fn a_written_panel_leaves_only_the_final_file() {
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());
        let data = PanelData {
            version: 1,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            cwd: "/w".to_string(),
            is_git: true,
            diff: None,
        };
        write_panel("atomic-write", &data, &panel);
        write_panel("atomic-write", &data, &panel);

        let names: Vec<_> = fs::read_dir(panel.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("panel.json")]);
    }

    #[test]
    fn closing_a_session_removes_its_directory() {
        let state = tempfile::tempdir().unwrap();
        let dir = state.path().join("closed-session");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("panel.json"), "{}").unwrap();

        remove_session_state("closed-session", &dir);
        assert!(!dir.exists());
        // Already gone is fine.
        remove_session_state("closed-session", &dir);
    }
}
