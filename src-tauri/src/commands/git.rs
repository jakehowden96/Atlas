use super::proc::no_window;
use super::prs::validate_repo_slug;
use super::validate::{validate_branch_name, validate_cwd};
use crate::panel::types::GitStatus;
use std::io::Read;
use std::process::{Command, Stdio};

/// A `git -C <cwd> <args>` command.
///
/// `GIT_OPTIONAL_LOCKS=0` stops read-only commands from opportunistically
/// refreshing the index: Atlas polls constantly and would otherwise collide
/// with Claude's or the user's own `git add`/`commit` on `.git/index.lock`.
fn git_command(cwd: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(["-C", cwd])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0");
    no_window(&mut cmd);
    cmd
}

/// Run git and return stdout verbatim. Diff and `-z` output is whitespace
/// significant (a trailing blank context line, NUL separators), so callers
/// that parse it must not go through the trimming `git_cmd`.
pub(crate) fn git_raw(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command(cwd, args).output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run git and return stdout trimmed, for commands that print a single token.
pub(crate) fn git_cmd(cwd: &str, args: &[&str]) -> Result<String, String> {
    git_raw(cwd, args).map(|s| s.trim().to_string())
}

/// Like `git_raw`, but reads at most `cap` bytes of stdout and then kills the
/// child. A regenerated lockfile or vendored directory can produce hundreds of
/// MB of diff; the caller truncates to a couple of MB anyway, so there is no
/// reason to buffer the rest. Returns the bytes read and whether output was cut.
pub(crate) fn git_raw_capped(
    cwd: &str,
    args: &[&str],
    cap: usize,
) -> Result<(String, bool), String> {
    let mut child = git_command(cwd, args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("git stdout was not captured".to_string());
    };

    let mut buf = Vec::new();
    let read = stdout.take(cap as u64 + 1).read_to_end(&mut buf);
    let truncated = buf.len() > cap;
    if truncated {
        buf.truncate(cap);
        // Closing the pipe would only stop git on its next write; kill it now.
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    read.map_err(|e| e.to_string())?;

    if !truncated && !status.success() {
        return Err(format!("git exited with {status}"));
    }
    Ok((String::from_utf8_lossy(&buf).into_owned(), truncated))
}

/// Check whether a directory should be skipped during repo scanning.
/// `name` is the directory basename.
/// Excluded entries are simple names (e.g. "vendor") for common non-repo dirs.
pub(crate) fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
}

/// Whether the working tree has changes the "Work on it" checkout would clobber.
///
/// One `git status` instead of seven spawns, and a git failure (lock, corrupt
/// repo) is an error rather than being read as "dirty".
fn git_status(cwd: &str) -> Result<GitStatus, String> {
    let porcelain = git_raw(cwd, &["status", "--porcelain=v1", "-z"])?;
    Ok(parse_porcelain(&porcelain))
}

/// `XY path` entries, NUL-separated. `X` is the index side, `Y` the worktree
/// side; `?` marks untracked files, which count as unstaged work. A rename or
/// copy is followed by a bare second path with no status columns.
fn parse_porcelain(porcelain: &str) -> GitStatus {
    let mut status = GitStatus {
        has_unstaged: false,
        has_staged: false,
    };
    let mut entries = porcelain.split('\0').filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        let mut columns = entry.chars();
        let (Some(index), Some(worktree)) = (columns.next(), columns.next()) else {
            continue;
        };
        if index == '?' {
            status.has_unstaged = true;
            continue;
        }
        if index != ' ' {
            status.has_staged = true;
        }
        if worktree != ' ' {
            status.has_unstaged = true;
        }
        if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            entries.next();
        }
    }
    status
}

/// Whether the tree has staged or unstaged changes, for the PR checkout guard.
#[tauri::command(async)]
pub async fn get_git_status(cwd: String) -> Result<GitStatus, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || git_status(&cwd))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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
        // scheme://[user@]host[:port]/owner/repo. `file://` remotes and empty
        // authorities are local paths, not hosted repos.
        Some((scheme, rest)) => {
            if scheme.eq_ignore_ascii_case("file") {
                return None;
            }
            let (authority, path) = rest.split_once('/')?;
            if authority.is_empty() {
                return None;
            }
            path
        }
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
            // `Path::is_dir` follows symlinks: a symlinked checkout is a real repo.
            if !entry.path().is_dir() {
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

/// Check out an existing local branch.
///
/// `validate_branch_name` only screens the spelling; git would still accept a
/// remote-only name (DWIM creates a tracking branch), `@{-1}`, a SHA or `HEAD`.
/// Requiring `refs/heads/<branch>` to exist and passing `--no-guess` and a
/// trailing `--` pins the meaning to "that local branch", even when a worktree
/// file shares its name.
fn checkout_local_branch(cwd: &str, branch: &str) -> Result<(), String> {
    let full_ref = format!("refs/heads/{branch}");
    git_cmd(cwd, &["rev-parse", "--verify", "--quiet", &full_ref])
        .map_err(|_| format!("No local branch named '{branch}'"))?;
    git_cmd(cwd, &["checkout", "--no-guess", branch, "--"]).map(|_| ())
}

#[tauri::command(async)]
pub async fn git_checkout_branch(cwd: String, branch: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    validate_branch_name(&branch)?;
    tokio::task::spawn_blocking(move || checkout_local_branch(&cwd, &branch))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Real-repo fixtures shared by the git, diff and panel tests.
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::Path;

    /// Run git in `dir` with a fixed identity, panicking on failure.
    pub fn git(dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atlas Test",
                "-c",
                "user.email=test@example.com",
                "-c",
                "commit.gpgsign=false",
            ])
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }

    pub fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-q", "-b", "main"]);
        dir
    }

    pub fn commit_all(dir: &Path, message: &str) {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-q", "-m", message]);
    }
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

    #[test]
    fn slug_rejects_file_urls_and_empty_authority() {
        assert_eq!(parse_remote_slug("file:///home/me/proj/repo.git"), None);
        assert_eq!(parse_remote_slug("https:///owner/repo"), None);
    }

    // --- git_cmd error handling ---

    #[test]
    fn git_cmd_nonexistent_dir() {
        let result = git_cmd("/nonexistent/path/that/should/not/exist", &["status"]);
        assert!(result.is_err());
    }

    // --- against real repos ---

    use super::test_support::{commit_all, git, init_repo};

    #[test]
    fn checkout_targets_the_local_branch_not_a_same_named_file() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(
            dir.join("feature"),
            "a file that shares the branch's name\n",
        )
        .unwrap();
        commit_all(dir, "init");
        git(dir, &["branch", "feature"]);

        checkout_local_branch(dir.to_str().unwrap(), "feature").unwrap();

        let head = git_cmd(
            dir.to_str().unwrap(),
            &["rev-parse", "--abbrev-ref", "HEAD"],
        )
        .unwrap();
        assert_eq!(head, "feature");
    }

    #[test]
    fn checkout_refuses_anything_but_an_existing_local_branch() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        commit_all(dir, "init");
        let cwd = dir.to_str().unwrap();
        let sha = git_cmd(cwd, &["rev-parse", "HEAD"]).unwrap();

        for spelling in ["HEAD", "@{-1}", sha.as_str(), "nonexistent"] {
            assert!(
                checkout_local_branch(cwd, spelling).is_err(),
                "{spelling} must not be treated as a local branch"
            );
        }
    }

    #[test]
    fn status_tells_staged_from_unstaged_and_untracked() {
        let repo = init_repo();
        let dir = repo.path();
        let cwd = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");

        let clean = git_status(cwd).unwrap();
        assert!(!clean.has_staged && !clean.has_unstaged);

        std::fs::write(dir.join("new.txt"), "x\n").unwrap();
        let untracked = git_status(cwd).unwrap();
        assert!(!untracked.has_staged && untracked.has_unstaged);

        git(dir, &["add", "new.txt"]);
        let staged = git_status(cwd).unwrap();
        assert!(staged.has_staged && !staged.has_unstaged);

        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        let both = git_status(cwd).unwrap();
        assert!(both.has_staged && both.has_unstaged);
    }

    #[test]
    fn status_survives_a_staged_rename() {
        let repo = init_repo();
        let dir = repo.path();
        let cwd = dir.to_str().unwrap();
        std::fs::write(dir.join("old.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        git(dir, &["mv", "old.txt", "new.txt"]);

        // The rename's second path (`old.txt`) is not a status entry: read as
        // one it would look like a file with columns `ol`.
        let status = git_status(cwd).unwrap();
        assert!(status.has_staged && !status.has_unstaged);
    }

    #[test]
    fn status_outside_a_repo_is_an_error_not_a_dirty_tree() {
        let dir = tempfile::tempdir().unwrap();
        assert!(git_status(dir.path().to_str().unwrap()).is_err());
    }

    #[test]
    fn capped_git_output_stops_at_the_cap() {
        let repo = init_repo();
        let dir = repo.path();
        let cwd = dir.to_str().unwrap();
        std::fs::write(dir.join("big.txt"), "old\n".repeat(50_000)).unwrap();
        commit_all(dir, "init");
        std::fs::write(dir.join("big.txt"), "new\n".repeat(50_000)).unwrap();

        let (out, truncated) = git_raw_capped(cwd, &["diff"], 1000).unwrap();
        assert!(truncated);
        assert_eq!(out.len(), 1000);

        let (small, truncated) = git_raw_capped(cwd, &["rev-parse", "HEAD"], 1000).unwrap();
        assert!(!truncated);
        assert_eq!(small.trim().len(), 40);
    }

    #[test]
    fn capped_git_output_reports_failure() {
        let repo = init_repo();
        let cwd = repo.path().to_str().unwrap();
        assert!(git_raw_capped(cwd, &["rev-parse", "no-such-ref"], 1000).is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn workspace_scan_finds_a_symlinked_checkout() {
        let real = init_repo();
        let workspace = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(real.path(), workspace.path().join("linked")).unwrap();

        let repos = list_workspace_repos(workspace.path().to_string_lossy().to_string())
            .await
            .unwrap();
        assert_eq!(repos.len(), 1);
        assert!(repos[0].path.ends_with("linked"));
    }
}
