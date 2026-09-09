use super::prs::validate_repo_slug;
use super::validate::{validate_branch_name, validate_cwd};
use crate::panel::types::GitStatus;
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

/// One git repo Atlas can act in: a workspace, or a repo one level inside it.
#[derive(serde::Serialize)]
pub struct WorkspaceRepo {
    /// Absolute path of the repo's working tree.
    pub path: String,
    /// `owner/repo` from its `origin`, or None when it has no usable remote.
    pub slug: Option<String>,
}

/// True when `dir` is the root of a git working tree.
fn is_git_root(dir: &str) -> bool {
    git_cmd(dir, &["rev-parse", "--show-toplevel"]).is_ok()
}

fn repo_at(path: &std::path::Path) -> WorkspaceRepo {
    let path = path.to_string_lossy().to_string();
    let slug = git_cmd(&path, &["remote", "get-url", "origin"])
        .ok()
        .and_then(|url| parse_remote_slug(&url));
    WorkspaceRepo { path, slug }
}

/// Every repo under a workspace: the workspace itself when it is one, and
/// otherwise the git repos sitting one directory inside it.
///
/// A workspace is often a folder that *holds* checkouts rather than being one —
/// the same shape `build_panel_multi` diffs across. Asking only the workspace
/// root for a remote leaves those repos with no slug at all, so the PRs screen
/// could not match a PR to anywhere to start a session.
///
/// One level deep, like the panel's scan: deeper nesting is a monorepo's
/// business, not a checkout layout.
#[tauri::command(async)]
pub async fn list_workspace_repos(workspace_path: String) -> Result<Vec<WorkspaceRepo>, String> {
    validate_cwd(&workspace_path)?;
    tokio::task::spawn_blocking(move || {
        if is_git_root(&workspace_path) {
            return Ok(vec![repo_at(std::path::Path::new(&workspace_path))]);
        }
        let Ok(read_dir) = std::fs::read_dir(&workspace_path) else {
            return Ok(Vec::new());
        };
        let mut repos: Vec<WorkspaceRepo> = Vec::new();
        for entry in read_dir.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if should_skip_dir(name) || !is_git_root(&path.to_string_lossy()) {
                continue;
            }
            repos.push(repo_at(&path));
        }
        repos.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(repos)
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
