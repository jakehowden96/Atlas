//! GitHub pull requests over GraphQL, signed in with the device-code flow.
//!
//! Scope: `repo`. GitHub's OAuth apps have no read-only scope for private
//! repositories (`public_repo` covers public ones only), and Atlas needs
//! private repos' pull requests and check runs. Atlas only ever reads.

pub mod graphql;
pub mod map;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use reqwest::{header, StatusCode};
use serde_json::{json, Value};

use super::clients::{is_configured, GITHUB_CLIENT_ID};
use super::provider::{
    AuthConfig, AuthFlow, ConnectorInfo, ConnectorKind, ConnectorProvider, PullRequest,
    PullRequestProvider, RepoRef, Viewer,
};
use crate::error::AtlasError;
use graphql::{RepoNode, Response};
pub use map::MappedPr;

const GRAPHQL_URL: &str = "https://api.github.com/graphql";

/// One repo's outcome; a failing repo does not fail the others.
#[derive(Debug)]
pub struct RepoPullRequests {
    pub repo: RepoRef,
    pub result: Result<Vec<MappedPr>, AtlasError>,
}

pub struct GithubProvider {
    url: String,
    client: reqwest::Client,
}

impl Default for GithubProvider {
    fn default() -> Self {
        Self::with_endpoint(GRAPHQL_URL)
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn split_slug(slug: &str) -> Result<(&str, &str), AtlasError> {
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match slug.split_once('/') {
        Some((o, n)) if ok(o) && ok(n) => Ok((o, n)),
        _ => Err(AtlasError::invalid_input(format!(
            "`{slug}` is not an owner/name repository"
        ))),
    }
}

impl GithubProvider {
    pub fn with_endpoint(url: &str) -> Self {
        Self {
            url: url.to_string(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("a plain reqwest client builds"),
        }
    }

    async fn post(
        &self,
        token: &str,
        query: &str,
        variables: Value,
    ) -> Result<Response, AtlasError> {
        let resp = self
            .client
            .post(&self.url)
            .bearer_auth(token)
            .header(header::USER_AGENT, "Atlas")
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(|e| AtlasError::ConnectorOffline {
                message: e.to_string(),
            })?;
        let status = resp.status();
        let header_u64 = |name: &str| {
            resp.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
        };
        let retry_at = header_u64("x-ratelimit-reset")
            .or_else(|| header_u64("retry-after").map(|s| now() + s))
            .unwrap_or_else(|| now() + 60);
        let exhausted = header_u64("x-ratelimit-remaining") == Some(0)
            || resp.headers().contains_key("retry-after");
        if status == StatusCode::TOO_MANY_REQUESTS || (status == StatusCode::FORBIDDEN && exhausted)
        {
            return Err(AtlasError::ConnectorRateLimited {
                message: "GitHub rate limit reached".into(),
                retry_at,
            });
        }
        let text = resp
            .text()
            .await
            .map_err(|e| AtlasError::ConnectorOffline {
                message: e.to_string(),
            })?;
        match status {
            s if s.is_success() => {
                let parsed: Response = serde_json::from_str(&text)?;
                if parsed
                    .errors
                    .iter()
                    .any(|e| e.kind.as_deref() == Some("RATE_LIMITED"))
                {
                    return Err(AtlasError::ConnectorRateLimited {
                        message: "GitHub rate limit reached".into(),
                        retry_at,
                    });
                }
                Ok(parsed)
            }
            StatusCode::UNAUTHORIZED => Err(AtlasError::ConnectorReconnectNeeded {
                message: "GitHub rejected the saved sign-in".into(),
            }),
            StatusCode::FORBIDDEN => Err(AtlasError::forbidden(text)),
            StatusCode::NOT_FOUND => Err(AtlasError::not_found(text)),
            s => Err(AtlasError::ConnectorRemote {
                message: text,
                status: s.as_u16(),
            }),
        }
    }

    /// Open pull requests per repo, `BATCH` repos to a request. A repo that
    /// fails (not found, SSO, a failed batch) reports its own error.
    pub async fn list_pull_requests_by_repo(
        &self,
        token: &str,
        repos: &[RepoRef],
    ) -> Vec<RepoPullRequests> {
        let mut out = Vec::with_capacity(repos.len());
        let mut valid = Vec::new();
        for repo in repos {
            match split_slug(&repo.slug) {
                Ok(parts) => valid.push((repo, parts)),
                Err(e) => out.push(RepoPullRequests {
                    repo: repo.clone(),
                    result: Err(e),
                }),
            }
        }
        for chunk in valid.chunks(graphql::BATCH) {
            let parts: Vec<(&str, &str)> = chunk.iter().map(|(_, p)| *p).collect();
            let resp = self
                .post(
                    token,
                    &graphql::open_prs_query(chunk.len()),
                    Value::Object(graphql::repo_variables(&parts)),
                )
                .await;
            for (i, (repo, _)) in chunk.iter().enumerate() {
                let result = match &resp {
                    Ok(r) => repo_result(r, i),
                    Err(e) => Err(e.clone()),
                };
                out.push(RepoPullRequests {
                    repo: (*repo).clone(),
                    result,
                });
            }
        }
        out
    }

    /// The newest pull request (open, draft or merged) whose head is `branch`.
    pub async fn pull_request_for_branch(
        &self,
        token: &str,
        repo: &RepoRef,
        branch: &str,
    ) -> Result<Option<MappedPr>, AtlasError> {
        let (owner, name) = split_slug(&repo.slug)?;
        let mut vars = graphql::repo_variables(&[(owner, name)]);
        vars.insert("h".into(), json!(branch));
        let resp = self
            .post(token, &graphql::branch_pr_query(), Value::Object(vars))
            .await?;
        Ok(repo_result(&resp, 0)?.into_iter().next())
    }
}

/// Alias `r{i}`'s pull requests, or the error GraphQL attached to it.
fn repo_result(resp: &Response, i: usize) -> Result<Vec<MappedPr>, AtlasError> {
    let alias = format!("r{i}");
    if let Some(e) = resp.errors.iter().find(|e| e.alias() == Some(&alias)) {
        return Err(e.to_atlas());
    }
    if let Some(e) = resp.errors.iter().find(|e| e.alias().is_none()) {
        return Err(AtlasError::ConnectorRemote {
            message: e.message.clone(),
            status: 200,
        });
    }
    let node = resp.data.as_ref().and_then(|d| d.get(&alias));
    match node {
        Some(Value::Null) | None => Err(AtlasError::not_found("repository not found")),
        Some(v) => {
            let repo: RepoNode = serde_json::from_value(v.clone())?;
            Ok(repo
                .pull_requests
                .nodes
                .into_iter()
                .map(map::map_pr)
                .collect())
        }
    }
}

#[async_trait]
impl ConnectorProvider for GithubProvider {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "github".into(),
            name: "GitHub".into(),
            kind: ConnectorKind::PullRequests,
            flow: AuthFlow::DeviceCode,
            configured: is_configured(GITHUB_CLIENT_ID),
        }
    }

    fn auth_config(&self) -> AuthConfig {
        AuthConfig {
            client_id: GITHUB_CLIENT_ID.into(),
            scopes: vec!["repo".into()],
            auth_url: "https://github.com/login/oauth/authorize".into(),
            token_url: "https://github.com/login/oauth/access_token".into(),
            redirect_ports: vec![],
            device_auth_url: Some("https://github.com/login/device/code".into()),
        }
    }

    async fn viewer(&self, token: &str) -> Result<Viewer, AtlasError> {
        let resp = self.post(token, graphql::VIEWER_QUERY, json!({})).await?;
        if let Some(e) = resp.errors.into_iter().next() {
            return Err(e.to_atlas());
        }
        let v = resp
            .data
            .as_ref()
            .and_then(|d| d.get("viewer"))
            .ok_or_else(|| AtlasError::parse("GitHub returned no viewer"))?;
        Ok(Viewer {
            login: v["login"].as_str().unwrap_or_default().to_string(),
            name: v["name"].as_str().map(str::to_string),
        })
    }

    fn pull_requests(&self) -> Option<&dyn PullRequestProvider> {
        Some(self)
    }
}

#[async_trait]
impl PullRequestProvider for GithubProvider {
    /// Flattens the per-repo results; fails only when every repo failed.
    async fn list_pull_requests(
        &self,
        token: &str,
        repos: &[RepoRef],
    ) -> Result<Vec<PullRequest>, AtlasError> {
        let mut prs = Vec::new();
        let mut first_error = None;
        let mut any_ok = false;
        for r in self.list_pull_requests_by_repo(token, repos).await {
            match r.result {
                Ok(list) => {
                    any_ok = true;
                    prs.extend(list.into_iter().map(|m| m.pr));
                }
                Err(e) => first_error = first_error.or(Some(e)),
            }
        }
        match first_error {
            Some(e) if !any_ok => Err(e),
            _ => Ok(prs),
        }
    }

    async fn checkout_ref(
        &self,
        _token: &str,
        _repo: &RepoRef,
        number: u32,
    ) -> Result<String, AtlasError> {
        Ok(format!("pull/{number}/head"))
    }
}

#[cfg(test)]
mod tests;
