//! Neutral connector types and the provider traits.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AtlasError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ConnectorKind {
    Tickets,
    PullRequests,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum AuthFlow {
    Browser,
    DeviceCode,
}

/// How a connector signs in. The user picks one per connector in Settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    /// Atlas's own OAuth app; `ConnectorInfo::flow` says which flow.
    #[serde(rename = "oauth")]
    OAuth,
    /// The provider's CLI on this machine (e.g. `gh`), asked for a token per use.
    Cli,
    /// A key the user pasted, used as-is.
    ApiKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    pub id: String,
    pub name: String,
    pub kind: ConnectorKind,
    pub flow: AuthFlow,
    /// The methods this connector offers, the default first.
    pub methods: Vec<AuthMethod>,
    /// Whether the OAuth app has a client id in this build.
    pub configured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectorStatus {
    NotLinked,
    Linked { account: String },
    ReconnectNeeded { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorState {
    pub info: ConnectorInfo,
    pub status: ConnectorStatus,
    /// The method the connector was linked with; `None` when not linked.
    pub method: Option<AuthMethod>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum TicketStatusKind {
    Backlog,
    Todo,
    InProgress,
    InReview,
    Done,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: String,
    pub title: String,
    pub status: String,
    pub status_kind: TicketStatusKind,
    pub url: String,
    pub assignee: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestState {
    Open,
    Draft,
    Merged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Pending,
    Pass,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    pub status: CheckStatus,
    pub details_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewState {
    Awaiting,
    Comments { count: u32 },
    Changes,
    Approved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    pub url: String,
    pub state: PullRequestState,
    pub head_ref_name: String,
    pub author: String,
    pub is_cross_repository: bool,
    /// Aggregate of `checks`; `None` when the PR has none.
    pub ci: Option<CheckStatus>,
    pub checks: Vec<Check>,
    pub review: ReviewState,
    pub created_at: String,
    pub updated_at: String,
    /// Logins of individually requested reviewers; team requests carry none.
    pub review_request_logins: Vec<String>,
    pub comments_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub slug: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Viewer {
    pub login: String,
    pub name: Option<String>,
}

/// What the sign-in flows need; never crosses IPC.
#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub client_id: String,
    pub scopes: Vec<String>,
    pub auth_url: String,
    pub token_url: String,
    /// Loopback ports the browser flow may listen on.
    pub redirect_ports: Vec<u16>,
    /// Set for providers that use the device-code flow.
    pub device_auth_url: Option<String>,
}

#[async_trait]
pub trait ConnectorProvider: Send + Sync {
    fn info(&self) -> ConnectorInfo;
    fn auth_config(&self) -> AuthConfig;
    async fn viewer(&self, token: &str) -> Result<Viewer, AtlasError>;
    /// A token from the provider's CLI, for `AuthMethod::Cli`.
    async fn cli_token(&self) -> Result<String, AtlasError> {
        Err(AtlasError::invalid_input(format!(
            "{} has no CLI sign-in",
            self.info().name
        )))
    }
    fn tickets(&self) -> Option<&dyn TicketProvider> {
        None
    }
    fn pull_requests(&self) -> Option<&dyn PullRequestProvider> {
        None
    }
}

#[async_trait]
pub trait TicketProvider: Send + Sync {
    async fn get_ticket(&self, token: &str, id: &str) -> Result<Ticket, AtlasError>;
}

#[async_trait]
pub trait PullRequestProvider: Send + Sync {
    async fn list_pull_requests(
        &self,
        token: &str,
        repos: &[RepoRef],
    ) -> Result<Vec<PullRequest>, AtlasError>;
}
