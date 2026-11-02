//! GraphQL query text, response shapes and error classification.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AtlasError;

/// Repos per request; each alias pulls up to 30 PRs with 100 checks apiece.
pub const BATCH: usize = 5;

const PR_FIELDS: &str =
    "fragment PrFields on PullRequest { number title url state isDraft updatedAt \
author{login} headRefName isCrossRepository reviewDecision \
reviewThreads(first:100){nodes{isResolved}} \
commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){pageInfo{hasNextPage} \
nodes{__typename ... on CheckRun{name status conclusion detailsUrl} \
... on StatusContext{context state targetUrl}}}}}}}}";

pub const VIEWER_QUERY: &str = "{ viewer { login name } }";

/// One request for several repos, aliased `r0`, `r1`, ... `pr_args` is the
/// `pullRequests(...)` argument list; `extra_var` declares any extra variable.
fn repos_query(count: usize, extra_var: &str, pr_args: &str) -> String {
    let decls: String = (0..count)
        .map(|i| format!("$o{i}:String!,$n{i}:String!,"))
        .collect();
    let body: String = (0..count)
        .map(|i| {
            format!(
                "r{i}:repository(owner:$o{i},name:$n{i}){{pullRequests({pr_args}){{nodes{{...PrFields}}}}}} "
            )
        })
        .collect();
    format!("query({decls}{extra_var}){{ {body} rateLimit{{remaining resetAt}} }} {PR_FIELDS}")
}

pub fn open_prs_query(count: usize) -> String {
    repos_query(
        count,
        "",
        "states:OPEN,first:30,orderBy:{field:UPDATED_AT,direction:DESC}",
    )
}

pub fn branch_pr_query() -> String {
    repos_query(
        1,
        "$h:String!",
        "headRefName:$h,states:[OPEN,MERGED],first:1,orderBy:{field:CREATED_AT,direction:DESC}",
    )
}

pub fn repo_variables(repos: &[(&str, &str)]) -> serde_json::Map<String, Value> {
    let mut vars = serde_json::Map::new();
    for (i, (owner, name)) in repos.iter().enumerate() {
        vars.insert(format!("o{i}"), json!(owner));
        vars.insert(format!("n{i}"), json!(name));
    }
    vars
}

#[derive(Debug, Deserialize)]
pub struct Response {
    pub data: Option<Value>,
    #[serde(default)]
    pub errors: Vec<GqlError>,
}

#[derive(Debug, Deserialize)]
pub struct GqlError {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub message: String,
    #[serde(default)]
    pub path: Vec<Value>,
}

impl GqlError {
    /// The repo alias (`r0`...) this error belongs to, if any.
    pub fn alias(&self) -> Option<&str> {
        self.path.first().and_then(Value::as_str)
    }

    pub fn to_atlas(&self) -> AtlasError {
        let sso = self.message.contains("SAML");
        match self.kind.as_deref() {
            Some("NOT_FOUND") => AtlasError::not_found(&self.message),
            Some("FORBIDDEN") => AtlasError::forbidden(&self.message),
            _ if sso => AtlasError::forbidden(&self.message),
            // GraphQL reports failures inside an HTTP 200.
            _ => AtlasError::ConnectorRemote {
                message: self.message.clone(),
                status: 200,
            },
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Connection<T> {
    #[serde(default = "Vec::new")]
    pub nodes: Vec<T>,
}

#[derive(Debug, Deserialize)]
pub struct RepoNode {
    #[serde(rename = "pullRequests")]
    pub pull_requests: Connection<PrNode>,
}

#[derive(Debug, Deserialize)]
pub struct Login {
    pub login: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrNode {
    pub number: u32,
    pub title: String,
    pub url: String,
    /// `OPEN`, `MERGED` or `CLOSED`.
    pub state: String,
    pub is_draft: bool,
    pub updated_at: String,
    pub author: Option<Login>,
    pub head_ref_name: String,
    pub is_cross_repository: bool,
    pub review_decision: Option<String>,
    pub review_threads: Option<Connection<Thread>>,
    pub commits: Option<Connection<CommitNode>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub is_resolved: bool,
}

#[derive(Debug, Deserialize)]
pub struct CommitNode {
    pub commit: Commit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub status_check_rollup: Option<Rollup>,
}

#[derive(Debug, Deserialize)]
pub struct Rollup {
    pub state: String,
    pub contexts: Contexts,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contexts {
    pub page_info: PageInfo,
    pub nodes: Vec<Context>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub has_next_page: bool,
}

/// A `CheckRun` (name, status, conclusion, detailsUrl) or a `StatusContext`
/// (context, state, targetUrl); the other kind's fields are absent.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub name: Option<String>,
    pub status: Option<String>,
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
    pub context: Option<String>,
    pub state: Option<String>,
    pub target_url: Option<String>,
}
