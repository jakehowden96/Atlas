use super::validate::{validate_branch_name, validate_cwd, validate_file_paths};
use crate::panel::types::{BranchInfo, GitStatus, RepoInfo};
use std::fs;
use std::process::Command;

pub(crate) fn git_cmd(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args([&["-C", cwd], args].concat())
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check whether a directory should be skipped during repo scanning.
/// `name` is the directory basename.
/// Excluded entries are simple names (e.g. "vendor") for common non-repo dirs.
pub(crate) fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
}

/// Stage all changes in the given git repo.
#[tauri::command(async)]
pub async fn git_stage_all(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["add", "-A"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Stage specific files in the given git repo.
#[tauri::command(async)]
pub async fn git_stage_files(cwd: String, files: Vec<String>) -> Result<(), String> {
    validate_cwd(&cwd)?;
    if files.is_empty() {
        return Ok(());
    }
    validate_file_paths(&cwd, &files)?;
    tokio::task::spawn_blocking(move || {
        let mut args = vec!["add", "-A", "--"];
        let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        git_cmd(&cwd, &args).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Discard all working tree changes (unstaged + staged) in the given git repo.
#[tauri::command(async)]
pub async fn git_discard_all(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let _ = git_cmd(&cwd, &["reset", "HEAD", "--"]);
        git_cmd(&cwd, &["checkout", "--", "."])?;
        git_cmd(&cwd, &["clean", "-fd"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Get the current git status for determining the adaptive button state.
#[tauri::command(async)]
pub async fn get_git_status(cwd: String) -> Result<GitStatus, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        // Verify this is actually a git repository
        git_cmd(&cwd, &["rev-parse", "--git-dir"])?;

        // Check for unstaged changes (working tree vs index)
        // git diff --quiet exits 1 when there are changes
        let has_modified = git_cmd(&cwd, &["diff", "--quiet"]).is_err();

        // Check for untracked files
        let has_untracked = git_cmd(&cwd, &["ls-files", "--others", "--exclude-standard"])
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        let has_unstaged = has_modified || has_untracked;

        // Check for staged changes (index vs HEAD)
        let has_staged = git_cmd(&cwd, &["diff", "--cached", "--quiet"]).is_err();

        // Check for unpushed commits
        let has_unpushed = git_cmd(&cwd, &["rev-list", "@{u}..HEAD", "--count"])
            .map(|s| s.trim().parse::<u32>().unwrap_or(0) > 0)
            .unwrap_or(false);

        // Check for commits behind upstream
        let commits_behind = git_cmd(&cwd, &["rev-list", "HEAD..@{u}", "--count"])
            .map(|s| s.trim().parse::<u32>().unwrap_or(0))
            .unwrap_or(0);

        // Get current branch
        let branch = git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
            .unwrap_or_default();

        Ok(GitStatus {
            has_unstaged,
            has_staged,
            has_unpushed,
            commits_behind,
            branch,
        })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Commit all changes with the given message. Stages everything first.
#[tauri::command(async)]
pub async fn git_commit(cwd: String, message: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    if message.contains('\0') {
        return Err("Commit message contains invalid characters".to_string());
    }
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["add", "-A"])?;
        git_cmd(&cwd, &["commit", "-m", &message])?;
        Ok(())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Push to the upstream remote.
#[tauri::command(async)]
pub async fn git_push(cwd: String) -> Result<String, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let has_upstream = git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok();

        if has_upstream {
            git_cmd(&cwd, &["push"])?;
            return Ok("Pushed to remote".to_string());
        }

        let has_origin = git_cmd(&cwd, &["remote", "get-url", "origin"]).is_ok();
        if !has_origin {
            return Err("No remote 'origin' configured. Add a remote first.".to_string());
        }

        let branch = git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        git_cmd(&cwd, &["push", "-u", "origin", &branch])?;
        Ok("Pushed and set upstream".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Fetch from remote with prune.
#[tauri::command(async)]
pub async fn git_fetch(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["fetch", "--prune"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Pull from remote.
#[tauri::command(async)]
pub async fn git_pull(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["pull"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// List child git repos with their current branch names.
#[tauri::command(async)]
pub async fn get_child_repos(cwd: String) -> Result<Vec<RepoInfo>, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let mut entries: Vec<_> = match fs::read_dir(&cwd) {
            Ok(e) => e.flatten().collect(),
            Err(_) => return Ok(Vec::new()),
        };
        entries.sort_by_key(|e| e.file_name());

        let mut repos = Vec::new();
        for entry in entries {
            if !entry.file_type().map_or(false, |t| t.is_dir()) {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();
            let child = entry.path().to_string_lossy().to_string();
            if should_skip_dir(&name_str) {
                continue;
            }
            if git_cmd(&child, &["rev-parse", "--show-toplevel"]).is_err() {
                continue;
            }
            let branch = git_cmd(&child, &["rev-parse", "--abbrev-ref", "HEAD"])
                .unwrap_or_default();
            let commits_behind = git_cmd(&child, &["rev-list", "HEAD..@{u}", "--count"])
                .map(|s| s.trim().parse::<u32>().unwrap_or(0))
                .unwrap_or(0);
            repos.push(RepoInfo { name: name_str, branch, commits_behind });
        }
        Ok(repos)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// List local branches with the current branch marked.
#[tauri::command(async)]
pub async fn git_list_branches(cwd: String) -> Result<Vec<BranchInfo>, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let output = git_cmd(&cwd, &["branch", "--format=%(refname:short)\t%(HEAD)"])?;
        let mut branches: Vec<BranchInfo> = output
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                if parts.len() == 2 {
                    Some(BranchInfo {
                        name: parts[0].trim().to_string(),
                        is_current: parts[1].trim() == "*",
                    })
                } else {
                    None
                }
            })
            .collect();

        let local_names: std::collections::HashSet<String> =
            branches.iter().map(|b| b.name.clone()).collect();
        for default_branch in &["main", "master"] {
            if !local_names.contains(*default_branch) {
                let remote_ref = format!("origin/{}", default_branch);
                if git_cmd(&cwd, &["rev-parse", "--verify", &format!("refs/remotes/{}", remote_ref)])
                    .is_ok()
                {
                    branches.push(BranchInfo {
                        name: default_branch.to_string(),
                        is_current: false,
                    });
                }
            }
        }

        Ok(branches)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Checkout an existing local branch.
#[tauri::command(async)]
pub async fn git_checkout_branch(cwd: String, branch: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    validate_branch_name(&branch)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["checkout", &branch]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Create and switch to a new branch via `git checkout -b`.
#[tauri::command(async)]
pub async fn git_create_branch(cwd: String, branch: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    validate_branch_name(&branch)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["checkout", "-b", &branch]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- should_skip_dir tests ---

    #[test]
    fn skip_hidden_dirs() {
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir(".hidden"));
    }

    #[test]
    fn skip_node_modules_and_target() {
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir("target"));
    }

    #[test]
    fn allow_normal_dirs() {
        assert!(!should_skip_dir("src"));
        assert!(!should_skip_dir("my-project"));
    }

    // --- git_cmd error handling ---

    #[test]
    fn git_cmd_nonexistent_dir() {
        let result = git_cmd("/nonexistent/path/that/should/not/exist", &["status"]);
        assert!(result.is_err());
    }
}
