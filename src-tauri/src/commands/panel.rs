use super::diff::{count_diff_stats, discover_diff, fit_to_budget, MAX_PANEL_DIFF_SIZE};
use super::git::{git_cmd, should_skip_dir};
use super::validate::{validate_cwd, validate_session_id};
use crate::atomic_write::write_atomic;
use crate::error::AtlasError;
use crate::panel::types::{sessions_dir, DiffData, PanelData, PanelIssue, ProjectDiff};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};

/// Per-session state, behind the mutex that serializes panel.json access.
#[derive(Default)]
struct PanelSlot {
    /// What the last write to `panel.json` held (see `panel_stamp`), so a
    /// refresh that found nothing new can skip rewriting it.
    last_written: Option<String>,
}

static PANEL_LOCKS: std::sync::LazyLock<Mutex<HashMap<String, Arc<Mutex<PanelSlot>>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn panel_lock(session_id: &str) -> Arc<Mutex<PanelSlot>> {
    let mut map = PANEL_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(session_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(PanelSlot::default())))
        .clone()
}

/// What makes one panel worth announcing over another: where it looks and what
/// it found. The timestamp is deliberately not part of it.
fn panel_stamp(data: &PanelData) -> String {
    let fingerprint = data.diff.as_ref().map_or("", |d| d.fingerprint.as_str());
    format!("{}\0{}", data.cwd, fingerprint)
}

#[tauri::command(async)]
pub fn get_panel_data(session_id: String) -> Result<Option<PanelData>, AtlasError> {
    validate_session_id(&session_id)?;
    let path = sessions_dir()?.join(&session_id).join("panel.json");
    // Same lock as the writer, and a missing file is "no data yet", not an error.
    let lock = panel_lock(&session_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AtlasError::io_at(&path, &e)),
    };
    let data: PanelData = serde_json::from_str(&contents)?;
    Ok(Some(data))
}

/// Run diff discovery for a CWD. Supports both single-repo and multi-repo layouts.
///
/// If CWD is inside a git repo → discover diff for that repo.
/// If CWD is NOT a git repo → scan child directories for git repos,
/// collect diffs from all repos with changes (like sift's scanForRepos).
#[tauri::command(async)]
pub async fn refresh_panel(
    session_id: String,
    cwd: String,
) -> Result<Option<PanelData>, AtlasError> {
    validate_session_id(&session_id)?;
    validate_cwd(&cwd)?;
    let panel_path = sessions_dir()?.join(&session_id).join("panel.json");

    // Run blocking git operations on a dedicated thread to avoid starving
    // the async runtime.
    let sid_clone = session_id.clone();
    let cwd_clone = cwd.clone();
    let path_clone = panel_path.clone();
    tokio::task::spawn_blocking(move || {
        match git_cmd(&cwd_clone, &["rev-parse", "--show-toplevel"]) {
            Ok(git_root) if !git_root.is_empty() => {
                build_panel_single(&sid_clone, &git_root, &path_clone)
            }
            Err(AtlasError::ToolMissing { .. }) => Ok(Some(git_missing_panel(&cwd_clone))),
            _ => build_panel_multi(&sid_clone, &cwd_clone, &path_clone),
        }
    })
    .await?
}

/// The panel for a machine with no git: nothing can be diffed, and the drawer
/// says why. Not written to panel.json, so no stale file outlives the fix.
fn git_missing_panel(cwd: &str) -> PanelData {
    PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: cwd.to_string(),
        diff: None,
        issue: Some(PanelIssue::GitNotFound),
    }
}

/// Single repo: discover diff and build PanelData
fn build_panel_single(
    session_id: &str,
    git_root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, AtlasError> {
    let bundle = discover_diff(git_root);

    if bundle.full.text.is_empty() {
        // Write the cleared state rather than deleting the file: a deletion
        // raises no `panel-update`, so other sessions' badges kept showing the
        // changes after they were committed.
        let cleared = PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: git_root.to_string(),
            diff: None,
            issue: None,
        };
        write_panel(session_id, &cleared, panel_path);
        return Ok(Some(cleared));
    }

    let (shown_files, lines_added, lines_removed) = count_diff_stats(&bundle.full.text);
    let files_changed = bundle.full.truncated.map_or(shown_files, |t| t.total_files);

    // Only populate local_raw when local differs from full (i.e. full includes upstream/branch changes)
    let (local_raw, local_truncated) =
        if !bundle.local.text.is_empty() && bundle.local.text != bundle.full.text {
            (Some(bundle.local.text), bundle.local.truncated)
        } else {
            (None, None)
        };

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: git_root.to_string(),
        diff: Some(
            DiffData {
                raw: bundle.full.text,
                files_changed,
                lines_added,
                lines_removed,
                fingerprint: String::new(),
                truncated: bundle.full.truncated,
                projects: None,
                local_raw,
                local_truncated,
            }
            .sealed(),
        ),
        issue: None,
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// Multi-repo: scan child dirs for git repos, aggregate diffs from all that have changes
fn build_panel_multi(
    session_id: &str,
    root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, AtlasError> {
    let mut dir_entries: Vec<_> = match fs::read_dir(root) {
        Ok(e) => e.flatten().collect(),
        Err(_) => return Ok(None),
    };
    // Sort for deterministic ordering — fs::read_dir order is platform-dependent
    dir_entries.sort_by_key(|e| e.file_name());

    let mut projects = Vec::new();
    let mut total_files: u32 = 0;
    let mut total_added: u32 = 0;
    let mut total_removed: u32 = 0;
    let mut found_any_repo = false;
    let mut budget = MAX_PANEL_DIFF_SIZE;

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
        if bundle.full.text.is_empty() {
            continue;
        }

        // One repo's cap is not enough on its own: N repos would still add up
        // to N times as much. Later repos get what earlier ones left over.
        let part = fit_to_budget(bundle.full, budget);
        budget -= part.text.len();

        let (shown_files, la, lr) = count_diff_stats(&part.text);
        let fc = part.truncated.map_or(shown_files, |t| t.total_files);
        total_files += fc;
        total_added += la;
        total_removed += lr;

        projects.push(ProjectDiff {
            name: name_str.to_string(),
            raw: part.text,
            files_changed: fc,
            lines_added: la,
            lines_removed: lr,
            truncated: part.truncated,
        });
    }

    if projects.is_empty() {
        if !found_any_repo {
            let lock = panel_lock(session_id);
            let mut slot = lock.lock().unwrap_or_else(|e| e.into_inner());
            let _ = fs::remove_file(panel_path);
            slot.last_written = None;
            return Ok(None);
        }
        let cleared = PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: root.to_string(),
            diff: None,
            issue: None,
        };
        write_panel(session_id, &cleared, panel_path);
        return Ok(Some(cleared));
    }

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: root.to_string(),
        diff: Some(
            DiffData {
                raw: String::new(),
                files_changed: total_files,
                lines_added: total_added,
                lines_removed: total_removed,
                fingerprint: String::new(),
                truncated: None,
                projects: Some(projects),
                local_raw: None,
                local_truncated: None,
            }
            .sealed(),
        ),
        issue: None,
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// Write `panel.json` for a session through a temp file and a rename, under the
/// session's lock. The file watcher and `get_panel_data` read it while a
/// refresh is writing; an in-place write would show them a truncated file.
///
/// Skipped when the file already holds this cwd and diff: the write would only
/// move the timestamp, yet make the watcher re-read and re-announce the whole
/// diff for every session on every poll.
fn write_panel(session_id: &str, data: &PanelData, panel_path: &std::path::Path) {
    let lock = panel_lock(session_id);
    let mut slot = lock.lock().unwrap_or_else(|e| e.into_inner());

    let stamp = panel_stamp(data);
    if slot.last_written.as_deref() == Some(stamp.as_str()) && panel_path.exists() {
        return;
    }

    let Some(dir) = panel_path.parent() else {
        log::warn!("panel.json path has no parent: {}", panel_path.display());
        return;
    };
    if let Err(e) = fs::create_dir_all(dir) {
        log::warn!("Failed to create session dir: {}", e);
        return;
    }
    let json = match serde_json::to_vec(data) {
        Ok(json) => json,
        Err(e) => {
            log::warn!("Failed to serialize panel data: {}", e);
            return;
        }
    };
    // The temp file is not named `panel.json`, so the watcher never mistakes
    // it for an update.
    match write_atomic(panel_path, &json) {
        Ok(()) => slot.last_written = Some(stamp),
        Err(e) => {
            log::warn!("Failed to write panel.json: {}", e);
            slot.last_written = None;
        }
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
    fn a_missing_git_reaches_the_webview_as_a_named_issue() {
        let json = serde_json::to_value(git_missing_panel("/w")).unwrap();
        assert_eq!(json["issue"], "git_not_found");
        assert!(json["diff"].is_null());
        // An ordinary panel carries no `issue` key at all.
        let ordinary = PanelData {
            issue: None,
            ..git_missing_panel("/w")
        };
        assert!(serde_json::to_value(ordinary)
            .unwrap()
            .get("issue")
            .is_none());
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
            diff: None,
            issue: None,
        };
        write_panel("atomic-write", &data, &panel);
        write_panel("atomic-write", &data, &panel);

        let names: Vec<_> = fs::read_dir(panel.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("panel.json")]);
    }

    fn mtime(path: &std::path::Path) -> std::time::SystemTime {
        fs::metadata(path).unwrap().modified().unwrap()
    }

    #[test]
    fn an_unchanged_diff_is_not_written_again() {
        let repo = init_repo();
        let dir = repo.path();
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        fs::write(dir.join("a.txt"), "two\n").unwrap();
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());
        let root = dir.to_str().unwrap();

        let first = build_panel_single("unchanged-diff", root, &panel)
            .unwrap()
            .unwrap();
        let written = mtime(&panel);
        std::thread::sleep(std::time::Duration::from_millis(20));

        // The watcher announces a panel.json event per write; an identical
        // diff must not produce one.
        let second = build_panel_single("unchanged-diff", root, &panel)
            .unwrap()
            .unwrap();
        assert_eq!(mtime(&panel), written);
        assert_eq!(
            first.diff.as_ref().unwrap().fingerprint,
            second.diff.as_ref().unwrap().fingerprint
        );

        fs::write(dir.join("a.txt"), "three\n").unwrap();
        let third = build_panel_single("unchanged-diff", root, &panel)
            .unwrap()
            .unwrap();
        assert!(mtime(&panel) > written);
        assert_ne!(
            first.diff.unwrap().fingerprint,
            third.diff.unwrap().fingerprint
        );
    }

    #[test]
    fn a_deleted_panel_file_is_written_again_even_if_nothing_changed() {
        let repo = init_repo();
        let dir = repo.path();
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        fs::write(dir.join("a.txt"), "two\n").unwrap();
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());
        let root = dir.to_str().unwrap();

        build_panel_single("redeleted", root, &panel).unwrap();
        fs::remove_file(&panel).unwrap();
        build_panel_single("redeleted", root, &panel).unwrap();
        assert!(panel.exists());
    }

    fn workspace_with_repos(names: &[&str], lines_each: usize) -> tempfile::TempDir {
        let workspace = tempfile::tempdir().unwrap();
        for name in names {
            let repo = workspace.path().join(name);
            fs::create_dir(&repo).unwrap();
            super::super::git::test_support::git(&repo, &["init", "-q", "-b", "main"]);
            fs::write(repo.join("a.txt"), "old\n".repeat(lines_each)).unwrap();
            commit_all(&repo, "init");
            fs::write(repo.join("a.txt"), "new\n".repeat(lines_each)).unwrap();
        }
        workspace
    }

    #[test]
    fn a_multi_repo_panel_carries_each_diff_once() {
        let workspace = workspace_with_repos(&["api", "web"], 10);
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());

        let data = build_panel_multi("multi-once", workspace.path().to_str().unwrap(), &panel)
            .unwrap()
            .unwrap();
        let diff = data.diff.unwrap();
        assert_eq!(diff.raw, "");
        let projects = diff.projects.unwrap();
        assert_eq!(
            projects.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            ["api", "web"]
        );
        assert!(projects.iter().all(|p| p.raw.contains("+new")));
        assert_eq!(diff.files_changed, 2);
    }

    #[test]
    fn a_multi_repo_panel_is_capped_across_repos_not_just_per_repo() {
        // Each repo's diff is ~1.6 MB: under the per-repo cap, but three of
        // them are over the panel's.
        let workspace = workspace_with_repos(&["a", "b", "c"], 200_000);
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());

        let data = build_panel_multi("multi-cap", workspace.path().to_str().unwrap(), &panel)
            .unwrap()
            .unwrap();
        let diff = data.diff.unwrap();
        let projects = diff.projects.unwrap();
        let shipped: usize = projects.iter().map(|p| p.raw.len()).sum();
        assert!(shipped <= MAX_PANEL_DIFF_SIZE, "{shipped}");
        assert!(projects.iter().any(|p| p.truncated.is_some()));
        // Every repo's change is still counted, and the ones cut say so.
        assert_eq!(diff.files_changed, 3);
        let last = projects.last().unwrap().truncated.unwrap();
        assert_eq!(last.total_files, 1);
    }

    #[test]
    fn a_truncated_single_repo_panel_reports_the_files_it_left_out() {
        let repo = init_repo();
        let dir = repo.path();
        for name in ["a.txt", "b.txt", "c.txt"] {
            fs::write(dir.join(name), "old\n".repeat(200_000)).unwrap();
        }
        commit_all(dir, "init");
        for name in ["a.txt", "b.txt", "c.txt"] {
            fs::write(dir.join(name), "new\n".repeat(200_000)).unwrap();
        }
        let state = tempfile::tempdir().unwrap();
        let panel = panel_file(state.path());

        let data = build_panel_single("single-cap", dir.to_str().unwrap(), &panel)
            .unwrap()
            .unwrap();
        let diff = data.diff.unwrap();
        assert_eq!(diff.files_changed, 3);
        let truncated = diff.truncated.expect("over the cap");
        assert!(truncated.shown_files < truncated.total_files);
        // The flag survives the trip through panel.json.
        assert_eq!(read_panel(&panel).diff.unwrap().truncated, Some(truncated));
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
