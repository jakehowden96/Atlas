use serde::{Deserialize, Serialize};
use std::process::Command;
use tokio::sync::OnceCell;
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

/// Per-repo result. `error` carries the stderr of a failed `gh` call so the UI
/// can show "this one repo broke" without poisoning the whole snapshot.
#[derive(Debug, Serialize, Clone)]
pub struct RepoPrs {
    pub repo: String,
    pub prs: Vec<Pr>,
    pub error: Option<String>,
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

fn fetch_one(repo: &str) -> RepoPrs {
    if let Err(e) = validate_repo_slug(repo) {
        return RepoPrs { repo: repo.to_string(), prs: vec![], error: Some(e) };
    }

    let output = Command::new("gh")
        .args([
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
        ])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            return RepoPrs {
                repo: repo.to_string(),
                prs: vec![],
                error: Some(format!("Failed to run gh: {}", e)),
            };
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return RepoPrs {
            repo: repo.to_string(),
            prs: vec![],
            error: Some(if stderr.is_empty() {
                format!("gh exited with status {}", output.status)
            } else {
                stderr
            }),
        };
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<Vec<RawPr>>(&stdout) {
        Ok(raws) => RepoPrs {
            repo: repo.to_string(),
            prs: raws.into_iter().map(flatten).collect(),
            error: None,
        },
        Err(e) => RepoPrs {
            repo: repo.to_string(),
            prs: vec![],
            error: Some(format!("Could not parse gh output: {}", e)),
        },
    }
}

/// Fan out `gh pr list` across every watched repo in parallel. Per-repo failures
/// land in `error` rather than propagating, so the UI can render the partial
/// snapshot. Order of the returned vec matches the input order.
#[tauri::command(async)]
pub async fn list_repo_prs(repos: Vec<String>) -> Result<Vec<RepoPrs>, String> {
    if repos.is_empty() {
        return Ok(vec![]);
    }

    let mut set = JoinSet::new();
    for (index, repo) in repos.into_iter().enumerate() {
        set.spawn(async move {
            let result = tokio::task::spawn_blocking(move || fetch_one(&repo))
                .await
                .map_err(|e| format!("Task join error: {}", e));
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
#[derive(Debug, Serialize, Clone)]
pub struct GhViewer {
    pub login: String,
}

/// Cached for the life of the process: the login cannot change without a new
/// `gh auth login`, and this sits on every Pull-requests render path. Only
/// successful lookups are cached, so signing in mid-session still resolves.
static VIEWER: OnceCell<GhViewer> = OnceCell::const_new();

fn fetch_viewer_login() -> Option<String> {
    let output = Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let login = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if login.is_empty() {
        None
    } else {
        Some(login)
    }
}

/// Who "me" is, for the Mine / Needs-my-review filters.
///
/// `gh` missing or signed out yields `Ok(None)`, never an error: the screen
/// degrades to All-only rather than breaking. `None` doubles as the auth state
/// Settings shows for "gh not authenticated".
#[tauri::command(async)]
pub async fn gh_viewer() -> Result<Option<GhViewer>, String> {
    if let Some(viewer) = VIEWER.get() {
        return Ok(Some(viewer.clone()));
    }
    let login = tokio::task::spawn_blocking(fetch_viewer_login)
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    Ok(login.map(|login| {
        let viewer = GhViewer { login };
        let _ = VIEWER.set(viewer.clone());
        viewer
    }))
}

/// The platform's "open this in the default handler" launcher.
/// Tauri 2 doesn't ship the opener plugin in this project, so we shell out.
fn browser_launcher(url: &str) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        // The empty "" is `start`'s window-title argument — without it `start`
        // consumes the URL as the title and opens nothing.
        cmd.args(["/C", "start", "", url]);
        cmd
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    }
}

/// Open an external URL in the user's default browser. Rejects anything that
/// isn't `https://` — that scheme check is the guard against launching
/// arbitrary handlers.
#[tauri::command(async)]
pub async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https:// URLs are allowed".to_string());
    }
    // `cmd /C start` re-parses its command line, so a shell metacharacter in
    // the URL would escape argument quoting on Windows.
    if url.contains(['&', '|', '^', '<', '>', '"', '%']) {
        return Err("URL contains characters that cannot be passed to the shell".to_string());
    }
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

    #[tokio::test]
    async fn gh_viewer_degrades_instead_of_erroring() {
        // Whether or not gh is installed and authenticated here, the command
        // must resolve — All-only is the fallback, an error is not. When it
        // does find a viewer the login is never blank; the filters match on it.
        let viewer = gh_viewer().await.expect("gh_viewer must never error");
        if let Some(viewer) = viewer {
            assert!(!viewer.login.is_empty());
        }
    }

    #[tokio::test]
    async fn open_url_rejects_non_https_schemes() {
        assert!(open_url("file:///etc/passwd".to_string()).await.is_err());
        assert!(open_url("http://example.com".to_string()).await.is_err());
        assert!(open_url("calculator".to_string()).await.is_err());
    }

    #[tokio::test]
    async fn open_url_rejects_shell_metacharacters() {
        assert!(open_url("https://example.com/&calc".to_string())
            .await
            .is_err());
        assert!(open_url("https://example.com/a|b".to_string()).await.is_err());
    }

    #[test]
    fn browser_launcher_targets_the_platform_opener() {
        let cmd = browser_launcher("https://example.com");
        let program = cmd.get_program().to_string_lossy().to_string();
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();

        #[cfg(target_os = "macos")]
        {
            assert_eq!(program, "open");
            assert_eq!(args, vec!["https://example.com"]);
        }
        #[cfg(target_os = "windows")]
        {
            assert_eq!(program, "cmd");
            assert_eq!(args, vec!["/C", "start", "", "https://example.com"]);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            assert_eq!(program, "xdg-open");
            assert_eq!(args, vec!["https://example.com"]);
        }
    }
}
