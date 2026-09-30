use super::proc::no_window;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, ExitStatus, Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{OnceCell, Semaphore};
use tokio::task::JoinSet;

/// One open pull request. We over-fetch from gh and then collapse the noisy
/// `statusCheckRollup` / `reviewDecision` / `comments` fields into small
/// scalars the UI can switch on directly.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: PrAuthor,
    pub created_at: String,
    pub updated_at: String,
    pub is_draft: bool,
    pub head_ref_name: String,
    /// "passed" | "failed" | "pending" | "none"
    pub ci_state: String,
    /// "approved" | "changes_requested" | "review_required" | "none"
    pub review_state: String,
    /// Logins of individually requested reviewers. Team requests carry no
    /// login and are dropped — "Needs my review" matches the viewer's login.
    pub review_request_logins: Vec<String>,
    pub comments_count: u32,
}

#[derive(Debug, Deserialize, Clone)]
struct RawPr {
    number: u64,
    title: String,
    url: String,
    author: PrAuthor,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "isDraft", default)]
    is_draft: bool,
    #[serde(rename = "headRefName", default)]
    head_ref_name: String,
    #[serde(rename = "reviewDecision", default)]
    review_decision: String,
    #[serde(rename = "reviewRequests", default)]
    review_requests: Vec<serde_json::Value>,
    #[serde(rename = "statusCheckRollup", default)]
    status_check_rollup: Vec<serde_json::Value>,
    #[serde(default)]
    comments: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrAuthor {
    #[serde(default)]
    pub login: String,
}

/// Collapse `gh`'s mixed StatusContext + CheckRun rollup into a single state.
/// Any failure dominates; otherwise any in-progress means pending; otherwise
/// if every check is good it's "passed"; an empty rollup is "none".
fn rollup_ci_state(checks: &[serde_json::Value]) -> &'static str {
    if checks.is_empty() {
        return "none";
    }
    let mut any_pending = false;
    let mut any_success = false;
    for c in checks {
        // CheckRun: status="COMPLETED"/"IN_PROGRESS"/"QUEUED"/"PENDING", conclusion="SUCCESS"/"FAILURE"/...
        // StatusContext: state="SUCCESS"/"FAILURE"/"ERROR"/"PENDING"
        if let Some(conclusion) = c.get("conclusion").and_then(|v| v.as_str()) {
            match conclusion {
                "FAILURE" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => return "failed",
                "CANCELLED" => {}
                "SUCCESS" => any_success = true,
                "NEUTRAL" | "SKIPPED" => {}
                "" => {
                    // No conclusion yet — fall through to status.
                    if let Some(status) = c.get("status").and_then(|v| v.as_str()) {
                        if matches!(status, "IN_PROGRESS" | "QUEUED" | "PENDING" | "WAITING") {
                            any_pending = true;
                        }
                    }
                }
                _ => {}
            }
        } else if let Some(state) = c.get("state").and_then(|v| v.as_str()) {
            match state {
                "FAILURE" | "ERROR" => return "failed",
                "PENDING" | "EXPECTED" => any_pending = true,
                "SUCCESS" => any_success = true,
                _ => {}
            }
        }
    }
    if any_pending {
        "pending"
    } else if any_success {
        "passed"
    } else {
        "none"
    }
}

fn map_review(decision: &str) -> &'static str {
    match decision {
        "APPROVED" => "approved",
        "CHANGES_REQUESTED" => "changes_requested",
        "REVIEW_REQUIRED" => "review_required",
        _ => "none",
    }
}

/// Pull the individual reviewer logins out of gh's `reviewRequests`. The
/// array mixes `User` entries (which have `login`) with `Team` entries (which
/// do not); only users can be matched against the viewer.
fn review_request_logins(requests: &[serde_json::Value]) -> Vec<String> {
    requests
        .iter()
        .filter_map(|r| r.get("login").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .collect()
}

fn flatten(raw: RawPr) -> Pr {
    Pr {
        number: raw.number,
        title: raw.title,
        url: raw.url,
        author: raw.author,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        is_draft: raw.is_draft,
        head_ref_name: raw.head_ref_name,
        ci_state: rollup_ci_state(&raw.status_check_rollup).to_string(),
        review_state: map_review(&raw.review_decision).to_string(),
        review_request_logins: review_request_logins(&raw.review_requests),
        comments_count: raw.comments.len() as u32,
    }
}

/// Why a `gh` call produced nothing. The first two are things the user fixes
/// outside Atlas (install, sign in), so the UI shows the fix rather than gh's
/// raw output.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GhErrorKind {
    /// No `gh` on PATH.
    NotInstalled,
    /// `gh` ran and said it has no credentials.
    NotAuthenticated,
    /// `gh` did not answer within `GH_TIMEOUT` and was killed.
    TimedOut,
    /// Anything else; `message` carries gh's stderr.
    Failed,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct GhError {
    pub kind: GhErrorKind,
    pub message: String,
}

impl GhError {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: GhErrorKind::Failed,
            message: message.into(),
        }
    }
}

/// Per-repo result. `error` describes a failed `gh` call so the UI can show
/// "this one repo broke" without poisoning the whole snapshot.
#[derive(Debug, Serialize, Clone)]
pub struct RepoPrs {
    pub repo: String,
    pub prs: Vec<Pr>,
    pub error: Option<GhError>,
}

/// Reject anything that isn't a plain `owner/repo` slug. Mirrors GitHub's own
/// constraints (letters, digits, dot, underscore, hyphen) — keeps stray shell
/// metacharacters out of the `--repo` argument even though we never go through
/// a shell.
pub(crate) fn validate_repo_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() {
        return Err("Repo slug cannot be empty".to_string());
    }
    let parts: Vec<&str> = slug.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Expected owner/repo, got '{}'", slug));
    }
    for part in &parts {
        if *part == "." || *part == ".." {
            return Err(format!("Invalid path segment in '{}'", slug));
        }
        if part.is_empty() {
            return Err(format!("Empty owner or repo in '{}'", slug));
        }
        if !part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        {
            return Err(format!("Invalid characters in '{}'", slug));
        }
    }
    Ok(())
}

/// How long one `gh` call may run before it is killed. A hung network call
/// would otherwise pin a blocking-pool thread and leave the screen loading.
const GH_TIMEOUT: Duration = Duration::from_secs(30);

/// `gh pr list` calls running at once. Watching many repos would otherwise fan
/// out one process each and trip GitHub's secondary rate limits.
const GH_CONCURRENCY: usize = 4;

/// Run `cmd` to completion, or kill it after `timeout`. `Ok(None)` means it was
/// killed. stdout and stderr are drained on their own threads: a child that
/// fills a pipe would otherwise block forever and look like a hang.
fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> std::io::Result<Option<Output>> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as _));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as _));

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // The pipes close with the process, so these joins return promptly.
    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    Ok(status.map(|status| Output {
        status,
        stdout,
        stderr,
    }))
}

/// Sort a finished `gh` call that did not succeed. gh exits 4 when it needs
/// authentication; the stderr wording covers versions and paths that do not.
fn classify_failure(status: &ExitStatus, stderr: &str) -> GhError {
    let message = if stderr.is_empty() {
        format!("gh exited with status {status}")
    } else {
        stderr.to_string()
    };
    let unauthenticated = status.code() == Some(4)
        || stderr.contains("gh auth login")
        || stderr.contains("not logged in");
    GhError {
        kind: if unauthenticated {
            GhErrorKind::NotAuthenticated
        } else {
            GhErrorKind::Failed
        },
        message,
    }
}

/// Run `program` (`gh`) with `args`; success returns its stdout.
fn run_gh(program: &str, args: &[&str]) -> Result<String, GhError> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    no_window(&mut cmd);
    let output = match run_with_timeout(&mut cmd, GH_TIMEOUT) {
        Ok(Some(output)) => output,
        Ok(None) => {
            return Err(GhError {
                kind: GhErrorKind::TimedOut,
                message: format!("gh did not answer within {}s", GH_TIMEOUT.as_secs()),
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(GhError {
                kind: GhErrorKind::NotInstalled,
                message: "The GitHub CLI (gh) was not found on PATH".to_string(),
            })
        }
        Err(e) => return Err(GhError::failed(format!("Failed to run gh: {e}"))),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(classify_failure(&output.status, &stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn fetch_one(program: &str, repo: &str) -> RepoPrs {
    let result = validate_repo_slug(repo).map_err(GhError::failed).and_then(|()| {
        let stdout = run_gh(
            program,
            &[
                "pr",
                "list",
                "--repo",
                repo,
                "--state",
                "open",
                "--json",
                "number,title,author,createdAt,updatedAt,url,isDraft,headRefName,reviewDecision,reviewRequests,statusCheckRollup,comments",
                "--limit",
                "50",
            ],
        )?;
        serde_json::from_str::<Vec<RawPr>>(&stdout)
            .map_err(|e| GhError::failed(format!("Could not parse gh output: {e}")))
    });
    match result {
        Ok(raws) => RepoPrs {
            repo: repo.to_string(),
            prs: raws.into_iter().map(flatten).collect(),
            error: None,
        },
        Err(error) => RepoPrs {
            repo: repo.to_string(),
            prs: vec![],
            error: Some(error),
        },
    }
}

/// Fan out `gh pr list` across every watched repo, a few at a time. Per-repo
/// failures land in `error` rather than propagating, so the UI can render the
/// partial snapshot. Order of the returned vec matches the input order.
#[tauri::command(async)]
pub async fn list_repo_prs(repos: Vec<String>) -> Result<Vec<RepoPrs>, String> {
    if repos.is_empty() {
        return Ok(vec![]);
    }

    let permits = Arc::new(Semaphore::new(GH_CONCURRENCY));
    let mut set = JoinSet::new();
    for (index, repo) in repos.into_iter().enumerate() {
        let permits = permits.clone();
        set.spawn(async move {
            let result = match permits.acquire_owned().await {
                Ok(_permit) => tokio::task::spawn_blocking(move || fetch_one("gh", &repo))
                    .await
                    .map_err(|e| format!("Task join error: {}", e)),
                Err(e) => Err(format!("Task join error: {}", e)),
            };
            (index, result)
        });
    }

    let mut results: Vec<Option<RepoPrs>> = Vec::new();
    while let Some(joined) = set.join_next().await {
        let (index, result) = joined.map_err(|e| format!("Task join error: {}", e))?;
        let repo_prs = result?;
        if results.len() <= index {
            results.resize_with(index + 1, || None);
        }
        results[index] = Some(repo_prs);
    }

    Ok(results.into_iter().flatten().collect())
}

/// The signed-in GitHub user, as reported by `gh`.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct GhViewer {
    pub login: String,
}

/// The answer to "who is signed in": the user, or why there is none.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct GhViewerResult {
    pub viewer: Option<GhViewer>,
    pub error: Option<GhError>,
}

impl GhViewerResult {
    fn signed_in(viewer: &GhViewer) -> Self {
        Self {
            viewer: Some(viewer.clone()),
            error: None,
        }
    }
}

/// Cached for the life of the process: the login cannot change without a new
/// `gh auth login`, and this sits on every Pull-requests render path. Only
/// successful lookups are cached, so signing in mid-session still resolves.
static VIEWER: OnceCell<GhViewer> = OnceCell::const_new();

fn fetch_viewer_login(program: &str) -> Result<String, GhError> {
    let stdout = run_gh(program, &["api", "user", "--jq", ".login"])?;
    let login = stdout.trim().to_string();
    if login.is_empty() {
        Err(GhError::failed("gh returned no login"))
    } else {
        Ok(login)
    }
}

/// Who "me" is, for the Mine / Needs-my-review filters.
///
/// `gh` missing or signed out is not an error: the result says which, so the
/// screen can show the fix and degrade to All-only meanwhile.
#[tauri::command(async)]
pub async fn gh_viewer() -> Result<GhViewerResult, String> {
    if let Some(viewer) = VIEWER.get() {
        return Ok(GhViewerResult::signed_in(viewer));
    }
    let login = tokio::task::spawn_blocking(|| fetch_viewer_login("gh"))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    Ok(match login {
        Ok(login) => {
            let viewer = GhViewer { login };
            let _ = VIEWER.set(viewer.clone());
            GhViewerResult::signed_in(&viewer)
        }
        Err(error) => GhViewerResult {
            viewer: None,
            error: Some(error),
        },
    })
}

/// The platform's "open this in the default handler" launcher.
/// Tauri 2 doesn't ship the opener plugin in this project, so we shell out.
fn browser_launcher(url: &str) -> Command {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut cmd = Command::new("cmd");
        // The empty "" is `start`'s window-title argument — without it `start`
        // consumes the URL as the title and opens nothing.
        cmd.args(["/C", "start", "", url]);
        cmd
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    };
    no_window(&mut cmd);
    cmd
}

/// The scheme check is the guard against launching arbitrary handlers: only
/// `https://` URLs may be opened.
fn check_open_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https:// URLs are allowed".to_string());
    }
    // `cmd /C start` re-parses its command line, so a shell metacharacter in
    // the URL would escape argument quoting on Windows. The other launchers
    // take the URL as a single argument, where `&` in a query string is just
    // a character.
    #[cfg(windows)]
    {
        if url.contains(['&', '|', '^', '<', '>', '"', '%']) {
            return Err("URL contains characters that cannot be passed to the shell".to_string());
        }
    }
    Ok(())
}

/// Open an external URL in the user's default browser.
#[tauri::command(async)]
pub async fn open_url(url: String) -> Result<(), String> {
    check_open_url(&url)?;
    tokio::task::spawn_blocking(move || {
        browser_launcher(&url)
            .status()
            .map_err(|e| format!("Failed to open URL: {}", e))
            .and_then(|status| {
                if status.success() {
                    Ok(())
                } else {
                    Err(format!("URL launcher exited with status {}", status))
                }
            })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_accepts_owner_repo() {
        assert!(validate_repo_slug("owner/repo").is_ok());
        assert!(validate_repo_slug("my-org/my.repo_42").is_ok());
    }

    #[test]
    fn slug_rejects_missing_slash() {
        assert!(validate_repo_slug("owner-repo").is_err());
    }

    #[test]
    fn slug_rejects_extra_slashes() {
        assert!(validate_repo_slug("owner/repo/extra").is_err());
    }

    #[test]
    fn slug_rejects_empty_parts() {
        assert!(validate_repo_slug("/repo").is_err());
        assert!(validate_repo_slug("owner/").is_err());
    }

    #[test]
    fn slug_rejects_shell_metacharacters() {
        assert!(validate_repo_slug("owner/repo;rm").is_err());
        assert!(validate_repo_slug("owner/repo$(id)").is_err());
        assert!(validate_repo_slug("owner /repo").is_err());
    }

    fn check(status: &str, conclusion: &str) -> serde_json::Value {
        serde_json::json!({
            "__typename": "CheckRun",
            "status": status,
            "conclusion": conclusion,
        })
    }

    fn ctx(state: &str) -> serde_json::Value {
        serde_json::json!({ "__typename": "StatusContext", "state": state })
    }

    #[test]
    fn rollup_none_when_empty() {
        assert_eq!(rollup_ci_state(&[]), "none");
    }

    #[test]
    fn rollup_failed_wins() {
        let checks = vec![
            check("COMPLETED", "SUCCESS"),
            check("COMPLETED", "FAILURE"),
            check("COMPLETED", "SUCCESS"),
        ];
        assert_eq!(rollup_ci_state(&checks), "failed");
    }

    #[test]
    fn rollup_pending_when_queued() {
        let checks = vec![check("COMPLETED", "SUCCESS"), check("QUEUED", "")];
        assert_eq!(rollup_ci_state(&checks), "pending");
    }

    #[test]
    fn rollup_passed_when_all_success() {
        let checks = vec![check("COMPLETED", "SUCCESS"), check("COMPLETED", "SUCCESS")];
        assert_eq!(rollup_ci_state(&checks), "passed");
    }

    #[test]
    fn rollup_skipped_neutral_dont_count() {
        let checks = vec![check("COMPLETED", "SKIPPED"), check("COMPLETED", "NEUTRAL")];
        assert_eq!(rollup_ci_state(&checks), "none");
    }

    #[test]
    fn rollup_handles_status_context() {
        assert_eq!(rollup_ci_state(&[ctx("SUCCESS")]), "passed");
        assert_eq!(rollup_ci_state(&[ctx("PENDING")]), "pending");
        assert_eq!(rollup_ci_state(&[ctx("FAILURE")]), "failed");
    }

    #[test]
    fn map_review_states() {
        assert_eq!(map_review("APPROVED"), "approved");
        assert_eq!(map_review("CHANGES_REQUESTED"), "changes_requested");
        assert_eq!(map_review("REVIEW_REQUIRED"), "review_required");
        assert_eq!(map_review(""), "none");
        assert_eq!(map_review("anything-else"), "none");
    }

    #[test]
    fn review_requests_keep_users_and_drop_teams() {
        let requests = vec![
            serde_json::json!({ "__typename": "User", "login": "octocat" }),
            serde_json::json!({ "__typename": "Team", "slug": "reviewers", "name": "Reviewers" }),
            serde_json::json!({ "__typename": "User", "login": "hubot" }),
        ];
        assert_eq!(review_request_logins(&requests), vec!["octocat", "hubot"]);
    }

    #[test]
    fn review_requests_empty_when_none() {
        assert!(review_request_logins(&[]).is_empty());
    }

    #[test]
    fn open_url_accepts_https_with_a_query_string() {
        assert!(check_open_url("https://example.com/?a=1&b=2").is_ok());
    }

    #[test]
    fn open_url_rejects_non_https_schemes() {
        assert!(check_open_url("file:///etc/passwd").is_err());
        assert!(check_open_url("http://example.com").is_err());
        assert!(check_open_url("calculator").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn open_url_rejects_cmd_metacharacters_on_windows() {
        assert!(check_open_url("https://example.com/&calc").is_err());
        assert!(check_open_url("https://example.com/a|b").is_err());
    }

    #[test]
    fn slug_rejects_dot_segments() {
        assert!(validate_repo_slug("./repo").is_err());
        assert!(validate_repo_slug("owner/..").is_err());
    }

    // --- gh states ---

    const NO_SUCH_GH: &str = "atlas-test-no-such-gh-binary";

    #[test]
    fn a_missing_gh_is_reported_as_not_installed_on_every_repo() {
        let repo = fetch_one(NO_SUCH_GH, "owner/repo");
        let error = repo.error.expect("no gh, no PRs");
        assert_eq!(error.kind, GhErrorKind::NotInstalled);
        assert!(repo.prs.is_empty());
    }

    #[test]
    fn a_missing_gh_is_reported_as_not_installed_for_the_viewer() {
        let error = fetch_viewer_login(NO_SUCH_GH).unwrap_err();
        assert_eq!(error.kind, GhErrorKind::NotInstalled);
    }

    #[test]
    fn an_invalid_slug_never_reaches_gh() {
        let repo = fetch_one(NO_SUCH_GH, "not a slug");
        // A validation failure, not the NotInstalled that spawning would give.
        assert_eq!(repo.error.unwrap().kind, GhErrorKind::Failed);
    }

    #[cfg(unix)]
    fn exit_status(code: i32) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(code << 8)
    }

    #[cfg(unix)]
    #[test]
    fn gh_exit_4_and_login_hints_mean_not_signed_in() {
        let by_code = classify_failure(&exit_status(4), "");
        assert_eq!(by_code.kind, GhErrorKind::NotAuthenticated);

        let by_text = classify_failure(
            &exit_status(1),
            "To get started with GitHub CLI, please run:  gh auth login",
        );
        assert_eq!(by_text.kind, GhErrorKind::NotAuthenticated);
        assert!(by_text.message.contains("gh auth login"));
    }

    #[cfg(unix)]
    #[test]
    fn other_gh_failures_keep_their_stderr() {
        let error = classify_failure(
            &exit_status(1),
            "GraphQL: Could not resolve to a Repository",
        );
        assert_eq!(error.kind, GhErrorKind::Failed);
        assert_eq!(error.message, "GraphQL: Could not resolve to a Repository");
        assert!(classify_failure(&exit_status(1), "")
            .message
            .contains("exited"));
    }

    #[cfg(unix)]
    #[test]
    fn a_hung_command_is_killed_at_the_timeout() {
        let started = Instant::now();
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 30"]);
        let output = run_with_timeout(&mut cmd, Duration::from_millis(200)).unwrap();
        assert!(output.is_none());
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[test]
    fn a_command_that_finishes_returns_all_of_its_output() {
        let mut cmd = Command::new("sh");
        // More than a pipe buffer on stdout, so an undrained pipe would hang.
        cmd.args(["-c", "head -c 300000 /dev/zero | tr '\\0' x; echo err >&2"]);
        let output = run_with_timeout(&mut cmd, Duration::from_secs(20))
            .unwrap()
            .expect("finishes in time");
        assert_eq!(output.stdout.len(), 300_000);
        assert_eq!(String::from_utf8_lossy(&output.stderr).trim(), "err");
    }
}
