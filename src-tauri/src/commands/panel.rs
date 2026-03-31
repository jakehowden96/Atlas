use crate::panel::watcher::{sessions_dir, DiffData, PanelData};
use std::fs;
use std::process::Command;

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
pub fn refresh_panel(session_id: String, cwd: String) -> Result<Option<PanelData>, String> {
    let panel_path = sessions_dir().join(&session_id).join("panel.json");

    // Try: is CWD itself inside a git repo?
    if let Ok(git_root) = git_cmd(&cwd, &["rev-parse", "--show-toplevel"]) {
        if !git_root.is_empty() {
            return build_panel_single(&session_id, &git_root, &panel_path);
        }
    }

    // Not a git repo — scan child directories for repos with diffs
    build_panel_multi(&session_id, &cwd, &panel_path)
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
    let output = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => String::from("1970-01-01T00:00:00Z"),
    }
}
