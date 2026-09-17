use crate::panel::types::{
    sessions_dir, DiffData, PanelData, ProjectDiff,
};
use super::diff::{count_diff_stats, discover_diff};
use super::git::{git_cmd, should_skip_dir};
use super::validate::{validate_cwd, validate_session_id};
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

#[tauri::command]
pub fn get_session_dir(session_id: String) -> Result<String, String> {
    validate_session_id(&session_id)?;
    let dir = sessions_dir()?.join(&session_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}

#[tauri::command(async)]
pub fn get_panel_data(session_id: String) -> Result<Option<PanelData>, String> {
    validate_session_id(&session_id)?;
    let path = sessions_dir()?.join(&session_id).join("panel.json");
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: PanelData = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
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
) -> Result<Option<PanelData>, String> {
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
        let _ = fs::remove_file(panel_path);
        return Ok(Some(PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: git_root.to_string(),
            is_git: true,
            diff: None,
        }));
    }

    let (files_changed, lines_added, lines_removed) = count_diff_stats(&bundle.full);

    // Only populate local_* fields when local differs from full (i.e. full includes upstream/branch changes)
    let (local_raw, local_fc, local_la, local_lr) = if !bundle.local.is_empty() && bundle.local != bundle.full {
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
        if !entry.file_type().map_or(false, |t| t.is_dir()) {
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
        let _ = fs::remove_file(panel_path);
        if !found_any_repo {
            return Ok(None);
        }
        return Ok(Some(PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: root.to_string(),
            is_git: true,
            diff: None,
        }));
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

fn write_panel(session_id: &str, data: &PanelData, panel_path: &std::path::Path) {
    let lock = panel_lock(session_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let dir = match sessions_dir() {
        Ok(d) => d.join(session_id),
        Err(e) => { log::warn!("Failed to resolve sessions dir: {}", e); return; }
    };
    if let Err(e) = fs::create_dir_all(&dir) {
        log::warn!("Failed to create session dir: {}", e);
        return;
    }
    match serde_json::to_string_pretty(data) {
        Ok(json) => {
            if let Err(e) = fs::write(panel_path, json) {
                log::warn!("Failed to write panel.json: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize panel data: {}", e),
    }
}

/// Free per-session state. Call when a PTY session is terminated.
pub fn cleanup_session_analysis(session_id: &str) {
    if let Ok(mut map) = PANEL_LOCKS.lock() {
        map.remove(session_id);
    }
}

fn now_iso8601() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso8601_format() {
        let ts = now_iso8601();
        assert!(ts.len() == 20, "Expected 20-char timestamp, got: {}", ts);
        assert!(ts.ends_with('Z'), "Expected Z suffix, got: {}", ts);
        assert!(ts.contains('T'), "Expected T separator, got: {}", ts);
        let parts: Vec<&str> = ts.split('T').collect();
        assert_eq!(parts.len(), 2);
        let date_parts: Vec<&str> = parts[0].split('-').collect();
        assert_eq!(date_parts.len(), 3);
        let year: i32 = date_parts[0].parse().unwrap();
        assert!(year >= 2024);
    }

    #[test]
    fn panel_data_serialization_roundtrip() {
        let data = PanelData {
            version: 1,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            cwd: "/tmp/test".to_string(),
            is_git: true,
            diff: Some(DiffData {
                raw: "diff --git a/f b/f\n+added".to_string(),
                files_changed: 1,
                lines_added: 1,
                lines_removed: 0,
                projects: None,
                local_raw: None,
                local_files_changed: None,
                local_lines_added: None,
                local_lines_removed: None,
            }),
        };

        let json = serde_json::to_string(&data).unwrap();
        let parsed: PanelData = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.cwd, "/tmp/test");
        assert!(parsed.diff.is_some());
        let diff = parsed.diff.unwrap();
        assert_eq!(diff.files_changed, 1);
        assert_eq!(diff.lines_added, 1);
        assert_eq!(diff.lines_removed, 0);
    }

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

    #[test]
    fn sessions_dir_returns_valid_path() {
        let dir = sessions_dir();
        assert!(dir.is_ok());
        let path = dir.unwrap();
        assert!(path.to_string_lossy().contains(".atlas"));
        assert!(path.to_string_lossy().contains("sessions"));
    }
}
