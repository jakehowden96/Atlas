use super::prs::validate_repo_slug;
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

/// Parse a git remote URL into an `owner/repo` slug.
///
/// Handles both remote forms git hands out: scp-like SSH
/// (`user@host:owner/repo.git`) and URL-shaped
/// (`https://host/owner/repo`, `ssh://user@host:22/owner/repo.git`).
/// Anything that isn't a two-segment path under a hostname — local paths
/// included — yields `None`.
pub(crate) fn parse_remote_slug(url: &str) -> Option<String> {
    let url = url.trim();
    let path = match url.split_once("://") {
        // scheme://[user@]host[:port]/owner/repo
        Some((_, rest)) => rest.split_once('/')?.1,
        None => {
            // scp-like [user@]host:owner/repo. `C:/repos/foo` also splits on a
            // colon, so require a dotted hostname to tell the two apart.
            let (authority, rest) = url.split_once(':')?;
            if !authority.contains('.') {
                return None;
            }
            rest
        }
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let path = path.trim_end_matches('/');

    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return None;
    }
    let slug = format!(
        "{}/{}",
        segments[segments.len() - 2],
        segments[segments.len() - 1]
    );
    validate_repo_slug(&slug).ok()?;
    Some(slug)
}

/// The `owner/repo` slug of a workspace's `origin` remote, or `None` when it
/// has no origin or the URL isn't a recognisable host path. Maps watched repos
/// onto workspaces so the PRs screen knows where to start a session.
#[tauri::command(async)]
pub async fn git_remote_slug(cwd: String) -> Result<Option<String>, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        Ok(git_cmd(&cwd, &["remote", "get-url", "origin"])
            .ok()
            .and_then(|url| parse_remote_slug(&url)))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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

    // --- parse_remote_slug tests ---

    #[test]
    fn slug_from_scp_ssh_remote() {
        assert_eq!(
            parse_remote_slug("git@github.com:jakehowden/Atlas.git"),
            Some("jakehowden/Atlas".to_string())
        );
        assert_eq!(
            parse_remote_slug("git@github.com:jakehowden/Atlas"),
            Some("jakehowden/Atlas".to_string())
        );
    }

    #[test]
    fn slug_from_ssh_url_remote() {
        assert_eq!(
            parse_remote_slug("ssh://git@github.com/jakehowden/Atlas.git"),
            Some("jakehowden/Atlas".to_string())
        );
        assert_eq!(
            parse_remote_slug("ssh://git@github.com:22/jakehowden/Atlas.git"),
            Some("jakehowden/Atlas".to_string())
        );
    }

    #[test]
    fn slug_from_https_remote() {
        assert_eq!(
            parse_remote_slug("https://github.com/jakehowden/Atlas.git"),
            Some("jakehowden/Atlas".to_string())
        );
        assert_eq!(
            parse_remote_slug("https://github.com/jakehowden/Atlas"),
            Some("jakehowden/Atlas".to_string())
        );
        assert_eq!(
            parse_remote_slug("https://user@github.com/jakehowden/Atlas.git/"),
            Some("jakehowden/Atlas".to_string())
        );
    }

    #[test]
    fn slug_takes_the_last_two_segments() {
        assert_eq!(
            parse_remote_slug("https://gitlab.com/group/subgroup/repo.git"),
            Some("subgroup/repo".to_string())
        );
    }

    #[test]
    fn slug_rejects_local_paths() {
        assert_eq!(parse_remote_slug("/home/me/repo.git"), None);
        assert_eq!(parse_remote_slug("C:/Users/me/repo"), None);
        assert_eq!(parse_remote_slug("../sibling/repo"), None);
    }

    #[test]
    fn slug_rejects_short_or_empty_paths() {
        assert_eq!(parse_remote_slug(""), None);
        assert_eq!(parse_remote_slug("https://github.com/repo"), None);
        assert_eq!(parse_remote_slug("https://github.com/"), None);
    }

    #[test]
    fn slug_rejects_invalid_characters() {
        assert_eq!(parse_remote_slug("https://github.com/own er/repo"), None);
    }

    // --- git_cmd error handling ---

    #[test]
    fn git_cmd_nonexistent_dir() {
        let result = git_cmd("/nonexistent/path/that/should/not/exist", &["status"]);
        assert!(result.is_err());
    }
}
