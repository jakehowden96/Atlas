//! Check out a pull request with plain `git`, using the user's own credentials.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::commands::proc::no_window;
use crate::commands::validate::validate_cwd;
use crate::error::AtlasError;

const FETCH_TIMEOUT: Duration = Duration::from_secs(120);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);

struct Out {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = pipe {
            let _ = p.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    })
}

/// Run git in `cwd` without ever prompting; kill it after `timeout`.
fn git(cwd: &str, args: &[&str], timeout: Duration) -> Result<Out, AtlasError> {
    let mut cmd = Command::new("git");
    cmd.args(["-C", cwd])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AtlasError::tool_missing("git", "git was not found on PATH")
        } else {
            AtlasError::tool_failed("git", e.to_string())
        }
    })?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(AtlasError::io)? {
            break s;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AtlasError::timeout(
                "git",
                "git took too long and was stopped. Check your connection and try again",
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    Ok(Out {
        ok: status.success(),
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// `owner/name` (lowercase) from an https, ssh or local-path remote URL.
fn slug_of(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let parts: Vec<&str> = url.rsplit(['/', ':', '\\']).take(2).collect();
    match parts[..] {
        [name, owner] => format!("{owner}/{name}").to_lowercase(),
        _ => url.to_lowercase(),
    }
}

fn remote_for(cwd: &str, repo: &str) -> Result<String, AtlasError> {
    let out = git(cwd, &["remote", "-v"], LOCAL_TIMEOUT)?;
    let want = repo.to_lowercase();
    out.stdout
        .lines()
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            Some((f.next()?, f.next()?))
        })
        .find(|(_, url)| slug_of(url) == want)
        .map(|(name, _)| name.to_string())
        .ok_or_else(|| AtlasError::not_found(format!("This folder has no git remote for {repo}")))
}

fn fetch_error(stderr: &str) -> AtlasError {
    let low = stderr.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| low.contains(n));
    if has(&[
        "authentication failed",
        "could not read username",
        "terminal prompts disabled",
        "permission denied",
        "access denied",
        "403",
    ]) {
        AtlasError::ConnectorDenied {
            message: "git could not sign in to the remote. Check your git credentials".into(),
        }
    } else if has(&[
        "could not resolve host",
        "unable to access",
        "connection",
        "network is unreachable",
        "timed out",
    ]) {
        AtlasError::ConnectorOffline {
            message: "Could not reach the remote. Check your connection".into(),
        }
    } else if has(&["couldn't find remote ref", "not found"]) {
        AtlasError::not_found("The remote has no such pull request")
    } else {
        AtlasError::tool_failed("git", format!("git fetch failed: {}", stderr.trim()))
    }
}

/// Fetch `pull/<number>/head` from the remote matching `remote_repo` and switch
/// to `pr/<number>`. Refuses a dirty tree. `head_ref_name` is the PR's branch
/// in the base repo; for same-repo PRs it becomes the upstream when the remote
/// already tracks it.
pub fn checkout_pull_request(
    cwd: &str,
    remote_repo: &str,
    number: u32,
    head_ref_name: Option<&str>,
    is_cross_repo: bool,
) -> Result<(), AtlasError> {
    validate_cwd(cwd)?;
    let inside = git(cwd, &["rev-parse", "--is-inside-work-tree"], LOCAL_TIMEOUT)?;
    if !inside.ok || inside.stdout.trim() != "true" {
        return Err(AtlasError::not_found("This folder is not a git repository"));
    }
    let remote = remote_for(cwd, remote_repo)?;

    let status = git(cwd, &["status", "--porcelain", "-uno"], LOCAL_TIMEOUT)?;
    let count = status.stdout.lines().count() as u32;
    if count > 0 {
        return Err(AtlasError::DirtyTree {
            message: format!("{count} changed file(s). Commit or stash them before switching"),
            count,
        });
    }

    let branch = format!("pr/{number}");
    let fetched = git(
        cwd,
        &["fetch", &remote, &format!("pull/{number}/head")],
        FETCH_TIMEOUT,
    )?;
    if !fetched.ok {
        return Err(fetch_error(&fetched.stderr));
    }

    let exists = git(
        cwd,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
        LOCAL_TIMEOUT,
    )?
    .ok;
    let switched = if exists {
        let s = git(cwd, &["switch", &branch], LOCAL_TIMEOUT)?;
        // Never discard local commits: only fast-forward an existing branch.
        if s.ok && !git(cwd, &["merge", "--ff-only", "FETCH_HEAD"], LOCAL_TIMEOUT)?.ok {
            return Err(AtlasError::already_exists(format!(
                "Local branch {branch} has commits the pull request does not. Rename or delete it first"
            )));
        }
        s
    } else {
        git(cwd, &["switch", "-c", &branch, "FETCH_HEAD"], LOCAL_TIMEOUT)?
    };
    if !switched.ok {
        return Err(AtlasError::tool_failed(
            "git",
            format!(
                "Fetched the pull request but could not switch to {branch}: {}",
                switched.stderr.trim()
            ),
        ));
    }

    if let (Some(head), false) = (head_ref_name, is_cross_repo) {
        // Best effort: the remote-tracking ref may not exist locally.
        let _ = git(
            cwd,
            &["branch", &format!("--set-upstream-to={remote}/{head}")],
            LOCAL_TIMEOUT,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn run(dir: &Path, args: &[&str]) -> String {
        let o = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            o.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    /// A bare remote at `<tmp>/acme/atlas.git` with main and `refs/pull/1/head`,
    /// plus a clone of it with a matching remote.
    fn setup() -> (tempfile::TempDir, String, String) {
        let tmp = tempfile::tempdir().unwrap();
        let bare = tmp.path().join("acme").join("atlas.git");
        std::fs::create_dir_all(&bare).unwrap();
        run(&bare, &["init", "--bare", "-b", "main"]);
        let seed = tmp.path().join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        run(&seed, &["init", "-b", "main"]);
        std::fs::write(seed.join("a.txt"), "a").unwrap();
        run(&seed, &["add", "."]);
        run(&seed, &["commit", "-m", "base"]);
        run(&seed, &["switch", "-c", "feature"]);
        std::fs::write(seed.join("b.txt"), "b").unwrap();
        run(&seed, &["add", "."]);
        run(&seed, &["commit", "-m", "pr"]);
        let url = bare.to_str().unwrap().to_string();
        run(&seed, &["remote", "add", "origin", &url]);
        run(&seed, &["push", "origin", "main"]);
        run(&seed, &["push", "origin", "feature:refs/pull/1/head"]);
        let work = tmp.path().join("work");
        run(tmp.path(), &["clone", &url, work.to_str().unwrap()]);
        (tmp, work.to_str().unwrap().to_string(), url)
    }

    fn branch(cwd: &str) -> String {
        run(Path::new(cwd), &["branch", "--show-current"])
    }

    #[test]
    fn fresh_checkout_and_recheckout() {
        let (_t, cwd, _) = setup();
        checkout_pull_request(&cwd, "acme/atlas", 1, Some("feature"), false).unwrap();
        assert_eq!(branch(&cwd), "pr/1");
        assert!(Path::new(&cwd).join("b.txt").exists());
        run(Path::new(&cwd), &["switch", "main"]);
        checkout_pull_request(&cwd, "Acme/Atlas", 1, None, true).unwrap();
        assert_eq!(branch(&cwd), "pr/1");
    }

    #[test]
    fn dirty_tree_is_refused_with_count() {
        let (_t, cwd, _) = setup();
        std::fs::write(Path::new(&cwd).join("a.txt"), "changed").unwrap();
        let err = checkout_pull_request(&cwd, "acme/atlas", 1, None, true).unwrap_err();
        assert!(
            matches!(err, AtlasError::DirtyTree { count: 1, .. }),
            "{err:?}"
        );
        assert_eq!(branch(&cwd), "main");
    }

    #[test]
    fn wrong_remote_and_non_repo() {
        let (t, cwd, _) = setup();
        let err = checkout_pull_request(&cwd, "other/repo", 1, None, true).unwrap_err();
        assert!(matches!(err, AtlasError::NotFound { .. }), "{err:?}");
        let plain = t.path().join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let err = checkout_pull_request(plain.to_str().unwrap(), "acme/atlas", 1, None, true)
            .unwrap_err();
        assert!(matches!(err, AtlasError::NotFound { .. }), "{err:?}");
    }

    #[test]
    fn fork_head_sets_no_upstream_and_missing_pr_is_not_found() {
        let (_t, cwd, _) = setup();
        checkout_pull_request(&cwd, "acme/atlas", 1, Some("feature"), true).unwrap();
        let up = Command::new("git")
            .args(["-C", &cwd, "rev-parse", "--abbrev-ref", "pr/1@{upstream}"])
            .output()
            .unwrap();
        assert!(!up.status.success());
        let err = checkout_pull_request(&cwd, "acme/atlas", 99, None, true).unwrap_err();
        assert!(matches!(err, AtlasError::NotFound { .. }), "{err:?}");
    }

    #[test]
    fn diverged_local_branch_is_a_conflict() {
        let (_t, cwd, _) = setup();
        checkout_pull_request(&cwd, "acme/atlas", 1, None, true).unwrap();
        std::fs::write(Path::new(&cwd).join("c.txt"), "c").unwrap();
        run(Path::new(&cwd), &["add", "."]);
        run(Path::new(&cwd), &["commit", "-m", "local"]);
        run(Path::new(&cwd), &["switch", "main"]);
        // The PR moves on, so pr/1 and the PR head have diverged.
        run(Path::new(&cwd), &["switch", "-c", "other"]);
        std::fs::write(Path::new(&cwd).join("d.txt"), "d").unwrap();
        run(Path::new(&cwd), &["add", "."]);
        run(Path::new(&cwd), &["commit", "-m", "remote"]);
        run(
            Path::new(&cwd),
            &["push", "-f", "origin", "other:refs/pull/1/head"],
        );
        run(Path::new(&cwd), &["switch", "main"]);
        let err = checkout_pull_request(&cwd, "acme/atlas", 1, None, true).unwrap_err();
        assert!(matches!(err, AtlasError::AlreadyExists { .. }), "{err:?}");
    }

    #[test]
    fn slugs_from_urls() {
        assert_eq!(slug_of("https://github.com/Acme/Atlas.git"), "acme/atlas");
        assert_eq!(slug_of("git@github.com:acme/atlas.git"), "acme/atlas");
    }
}
