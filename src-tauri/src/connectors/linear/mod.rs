//! Linear ticket provider (read-only, PKCE browser flow, public client).
//!
//! Lookup query (Linear's `issue(id:)` accepts the human identifier such as
//! `ENG-482` as well as the UUID, per the API docs):
//!
//! ```graphql
//! query($id: String!) { issue(id: $id) {
//!   identifier title url assignee { displayName }
//!   state { name type } } }
//! ```
//!
//! Errors: not found -> `NotFound`; issue in a workspace the token cannot see
//! -> `Forbidden`; revoked token -> `ConnectorReconnectNeeded`; rate limit ->
//! `ConnectorRateLimited`. Bad ids -> `InvalidInput` with no request.

mod graphql;
mod map;

use async_trait::async_trait;

use super::clients::{is_configured, LINEAR_CLIENT_ID, LINEAR_REDIRECT_PORTS};
use super::provider::*;
use crate::error::AtlasError;

const API_URL: &str = "https://api.linear.app/graphql";

const ISSUE_QUERY: &str = "query($id: String!) { issue(id: $id) { identifier title url \
assignee { displayName } state { name type } } }";
const VIEWER_QUERY: &str = "query { viewer { name displayName } }";

pub struct LinearProvider {
    client: reqwest::Client,
    api_url: String,
}

impl LinearProvider {
    pub fn new() -> Self {
        Self::with_api_url(API_URL)
    }

    pub fn with_api_url(api_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_url: api_url.to_string(),
        }
    }
}

impl Default for LinearProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ConnectorProvider for LinearProvider {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "linear".into(),
            name: "Linear".into(),
            kind: ConnectorKind::Tickets,
            flow: AuthFlow::Browser,
            configured: is_configured(LINEAR_CLIENT_ID),
        }
    }

    fn auth_config(&self) -> AuthConfig {
        AuthConfig {
            client_id: LINEAR_CLIENT_ID.into(),
            scopes: vec!["read".into()],
            auth_url: "https://linear.app/oauth/authorize".into(),
            token_url: "https://api.linear.app/oauth/token".into(),
            redirect_ports: LINEAR_REDIRECT_PORTS.to_vec(),
            device_auth_url: None,
        }
    }

    async fn viewer(&self, token: &str) -> Result<Viewer, AtlasError> {
        let data = graphql::post(
            &self.client,
            &self.api_url,
            token,
            VIEWER_QUERY,
            serde_json::json!({}),
        )
        .await?;
        let v = &data["viewer"];
        Ok(Viewer {
            login: v["displayName"].as_str().unwrap_or_default().to_string(),
            name: v["name"].as_str().map(str::to_string),
        })
    }

    fn tickets(&self) -> Option<&dyn TicketProvider> {
        Some(self)
    }
}

#[async_trait]
impl TicketProvider for LinearProvider {
    async fn get_ticket(&self, token: &str, id: &str) -> Result<Ticket, AtlasError> {
        let id = map::parse_ticket_id(id)?;
        let data = graphql::post(
            &self.client,
            &self.api_url,
            token,
            ISSUE_QUERY,
            serde_json::json!({ "id": id }),
        )
        .await?;
        let issue = &data["issue"];
        if issue.is_null() {
            return Err(AtlasError::NotFound {
                message: format!("No ticket {id} in Linear"),
            });
        }
        let s = |v: &serde_json::Value| v.as_str().unwrap_or_default().to_string();
        let state_name = s(&issue["state"]["name"]);
        Ok(Ticket {
            id: s(&issue["identifier"]),
            title: s(&issue["title"]),
            status_kind: map::status_kind(
                issue["state"]["type"].as_str().unwrap_or_default(),
                &state_name,
            ),
            status: state_name,
            url: s(&issue["url"]),
            assignee: issue["assignee"]["displayName"]
                .as_str()
                .map(str::to_string),
        })
    }
}

#[cfg(test)]
mod tests;
