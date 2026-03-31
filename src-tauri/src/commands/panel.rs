use crate::claude::ClaudeClient;
use crate::panel::watcher::{sessions_dir, DiffData, PanelData, ProjectDiff};
use std::fs;
use std::process::Command;
use tauri::Manager;

#[tauri::command]
pub fn get_session_dir(session_id: String) -> Result<String, String> {
    let dir = sessions_dir().join(&session_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}

#[tauri::command]
pub fn get_panel_data(session_id: String) -> Result<Option<PanelData>, String> {
    let path = sessions_dir().join(&session_id).join("panel.json");
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
#[tauri::command]
pub fn refresh_panel(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: String,
) -> Result<Option<PanelData>, String> {
    let panel_path = sessions_dir().join(&session_id).join("panel.json");

    // Try: is CWD itself inside a git repo?
    let result = if let Ok(git_root) = git_cmd(&cwd, &["rev-parse", "--show-toplevel"]) {
        if !git_root.is_empty() {
            build_panel_single(&session_id, &git_root, &panel_path)?
        } else {
            build_panel_multi(&session_id, &cwd, &panel_path)?
        }
    } else {
        build_panel_multi(&session_id, &cwd, &panel_path)?
    };

    // Spawn async Claude analysis if we have a diff and an API key
    if let Some(ref data) = result {
        if let Some(ref diff) = data.diff {
            let claude_opt: tauri::State<Option<ClaudeClient>> = app_handle.state();
            if claude_opt.is_some() {
                let raw_diff = diff.raw.clone();
                let sid = session_id.clone();
                let path = panel_path.clone();
                let handle = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    let claude_state: tauri::State<Option<ClaudeClient>> = handle.state();
                    let client = match claude_state.as_ref() {
                        Some(c) => c,
                        None => return,
                    };

                    match client.analyze_diff(&raw_diff).await {
                        Ok((summary, flow)) => {
                            // Read existing panel.json and merge in analysis
                            if let Ok(contents) = fs::read_to_string(&path) {
                                if let Ok(mut panel) =
                                    serde_json::from_str::<PanelData>(&contents)
                                {
                                    panel.summary = Some(summary);
                                    panel.flow = Some(flow);
                                    write_panel(&sid, &panel, &path);
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Claude analysis failed: {}", e);
                        }
                    }
                });
            }
        }
    }

    Ok(result)
}

/// Single repo: discover diff and build PanelData
fn build_panel_single(
    session_id: &str,
    git_root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, String> {
    let raw_diff = discover_diff(git_root);

    if raw_diff.is_empty() {
        let _ = fs::remove_file(panel_path);
        return Ok(None);
    }

    let (files_changed, lines_added, lines_removed) = count_diff_stats(&raw_diff);

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: git_root.to_string(),
        diff: Some(DiffData {
            raw: raw_diff,
            files_changed,
            lines_added,
            lines_removed,
            projects: None,
        }),
        summary: None,
        flow: None,
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
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };

    let mut all_diffs = Vec::new();
    let mut projects = Vec::new();
    let mut total_files: u32 = 0;
    let mut total_added: u32 = 0;
    let mut total_removed: u32 = 0;

    for entry in entries.flatten() {
        if !entry.file_type().map_or(false, |t| t.is_dir()) {
            continue;
        }

        // Skip hidden dirs and common non-repo dirs
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "node_modules" || name_str == "target" {
            continue;
        }

        let child_path = entry.path();
        let child_str = child_path.to_string_lossy().to_string();

        // Check if this child is a git repo
        if git_cmd(&child_str, &["rev-parse", "--show-toplevel"]).is_err() {
            continue;
        }

        let diff = discover_diff(&child_str);
        if diff.is_empty() {
            continue;
        }

        let (fc, la, lr) = count_diff_stats(&diff);
        total_files += fc;
        total_added += la;
        total_removed += lr;

        projects.push(ProjectDiff {
            name: name_str.to_string(),
            raw: diff.clone(),
            files_changed: fc,
            lines_added: la,
            lines_removed: lr,
        });

        all_diffs.push(diff);
    }

    if all_diffs.is_empty() {
        let _ = fs::remove_file(panel_path);
        return Ok(None);
    }

    let combined = all_diffs.join("\n");

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: root.to_string(),
        diff: Some(DiffData {
            raw: combined,
            files_changed: total_files,
            lines_added: total_added,
            lines_removed: total_removed,
            projects: Some(projects),
        }),
        summary: None,
        flow: None,
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// 3-tier diff discovery matching sift's extractBestDiff
fn discover_diff(git_root: &str) -> String {
    // Tier 1: Working tree changes (staged + unstaged vs HEAD)
    if let Ok(diff) = git_cmd(git_root, &["diff", "--unified=3", "HEAD"]) {
        if !diff.is_empty() {
            return diff;
        }
    }

    // Tier 1b: If HEAD doesn't exist (initial commit), try bare git diff
    if let Ok(diff) = git_cmd(git_root, &["diff", "--unified=3"]) {
        if !diff.is_empty() {
            return diff;
        }
    }

    // Tier 1c: Staged-only changes
    if let Ok(diff) = git_cmd(git_root, &["diff", "--cached", "--unified=3"]) {
        if !diff.is_empty() {
            return diff;
        }
    }

    // Tier 2: Unpushed commits vs upstream tracking branch
    if let Ok(upstream) = git_cmd(
        git_root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    ) {
        if !upstream.is_empty() {
            let range = format!("{}..HEAD", upstream);
            if let Ok(diff) = git_cmd(git_root, &["diff", "--unified=3", &range]) {
                if !diff.is_empty() {
                    return diff;
                }
            }
        }
    }

    // Tier 3: Branch diff vs merge-base with main/master
    let base_branch = if git_cmd(git_root, &["rev-parse", "--verify", "main"]).is_ok() {
        "main"
    } else if git_cmd(git_root, &["rev-parse", "--verify", "master"]).is_ok() {
        "master"
    } else {
        return String::new();
    };

    if let Ok(merge_base) = git_cmd(git_root, &["merge-base", base_branch, "HEAD"]) {
        if !merge_base.is_empty() {
            let range = format!("{}..HEAD", merge_base);
            if let Ok(diff) = git_cmd(git_root, &["diff", "--unified=3", &range]) {
                return diff;
            }
        }
    }

    String::new()
}

fn count_diff_stats(raw: &str) -> (u32, u32, u32) {
    let files = raw.matches("\ndiff --git ").count() as u32
        + if raw.starts_with("diff --git ") { 1 } else { 0 };
    let added = raw
        .lines()
        .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
        .count() as u32;
    let removed = raw
        .lines()
        .filter(|l| l.starts_with('-') && !l.starts_with("---"))
        .count() as u32;
    (files, added, removed)
}

fn write_panel(session_id: &str, data: &PanelData, panel_path: &std::path::Path) {
    let dir = sessions_dir().join(session_id);
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let _ = fs::write(panel_path, json);
    }
}

/// Stage all changes in the given git repo.
#[tauri::command]
pub fn git_stage_all(cwd: String) -> Result<(), String> {
    git_cmd(&cwd, &["add", "-A"]).map(|_| ())
}

/// Discard all working tree changes (unstaged + staged) in the given git repo.
#[tauri::command]
pub fn git_discard_all(cwd: String) -> Result<(), String> {
    // Reset staged changes
    let _ = git_cmd(&cwd, &["reset", "HEAD", "--"]);
    // Discard unstaged changes to tracked files
    git_cmd(&cwd, &["checkout", "--", "."])?;
    // Remove untracked files and directories
    git_cmd(&cwd, &["clean", "-fd"]).map(|_| ())
}

fn git_cmd(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args([&["-C", cwd], args].concat())
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Manual UTC formatting to avoid pulling in chrono for one function
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Days since epoch to Y-M-D (civil calendar)
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for days_in_month in &month_days {
        if remaining < *days_in_month as i64 {
            break;
        }
        remaining -= *days_in_month as i64;
        m += 1;
    }

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m + 1, remaining + 1, hours, minutes, seconds
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_diff_stats_single_file() {
        let diff = "\
diff --git a/file.rs b/file.rs
--- a/file.rs
+++ b/file.rs
@@ -1,3 +1,4 @@
 unchanged
+added line
-removed line
 unchanged";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 1);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn count_diff_stats_multiple_files() {
        let diff = "\
diff --git a/a.rs b/a.rs
--- a/a.rs
+++ b/a.rs
@@ -1,2 +1,3 @@
 unchanged
+added1
+added2

diff --git a/b.rs b/b.rs
--- a/b.rs
+++ b/b.rs
@@ -1,3 +1,2 @@
 unchanged
-removed1
-removed2";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 2);
        assert_eq!(added, 2);
        assert_eq!(removed, 2);
    }

    #[test]
    fn count_diff_stats_empty() {
        let (files, added, removed) = count_diff_stats("");
        assert_eq!(files, 0);
        assert_eq!(added, 0);
        assert_eq!(removed, 0);
    }

    #[test]
    fn count_diff_stats_excludes_file_markers() {
        // Lines starting with +++ or --- are file markers, not content changes
        let diff = "\
diff --git a/file.rs b/file.rs
--- a/file.rs
+++ b/file.rs
@@ -1 +1 @@
-old
+new";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 1);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn now_iso8601_format() {
        let ts = now_iso8601();
        // Should match ISO 8601 UTC format
        assert!(
            ts.len() == 20,
            "Expected 20-char timestamp, got: {}",
            ts
        );
        assert!(ts.ends_with('Z'), "Expected Z suffix, got: {}", ts);
        assert!(ts.contains('T'), "Expected T separator, got: {}", ts);
        // Should parse as valid date components
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
            diff: Some(DiffData {
                raw: "diff --git a/f b/f\n+added".to_string(),
                files_changed: 1,
                lines_added: 1,
                lines_removed: 0,
                projects: None,
            }),
            summary: None,
            flow: None,
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
        assert!(parsed.summary.is_none());
        assert!(parsed.flow.is_none());
    }
}
