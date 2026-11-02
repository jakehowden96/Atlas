//! Tauri commands. The sign-in flows are stubs until their phases land.

use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::oauth::device::{self, DeviceOutcome};
use super::provider::{
    AuthFlow, ConnectorProvider, ConnectorState, ConnectorStatus, PullRequest, RepoRef, Ticket,
};
use super::Connectors;
use crate::error::AtlasError;

fn provider<'a>(c: &'a Connectors, id: &str) -> Result<&'a Arc<dyn ConnectorProvider>, AtlasError> {
    c.registry
        .get(id)
        .ok_or_else(|| AtlasError::not_found(format!("No connector named {id}")))
}

fn configured<'a>(
    c: &'a Connectors,
    id: &str,
) -> Result<&'a Arc<dyn ConnectorProvider>, AtlasError> {
    let p = provider(c, id)?;
    if p.info().configured {
        Ok(p)
    } else {
        Err(AtlasError::ConnectorNotConfigured {
            message: format!("{} has no client id yet", p.info().name),
        })
    }
}

/// The provider for `id`, only if it is configured and linked.
fn linked<'a>(c: &'a Connectors, id: &str) -> Result<&'a Arc<dyn ConnectorProvider>, AtlasError> {
    let p = configured(c, id)?;
    match c.status(id)? {
        ConnectorStatus::Linked { .. } => Ok(p),
        ConnectorStatus::ReconnectNeeded { reason } => {
            Err(AtlasError::ConnectorReconnectNeeded { message: reason })
        }
        _ => Err(AtlasError::ConnectorNotLinked {
            message: format!("{} is not connected", p.info().name),
        }),
    }
}

fn not_ready() -> AtlasError {
    AtlasError::internal("Connector requests arrive with the sign-in flows")
}

#[tauri::command(async)]
pub fn connector_list(c: State<'_, Connectors>) -> Result<Vec<ConnectorState>, AtlasError> {
    c.list()
}

#[tauri::command]
pub async fn connector_connect(
    id: String,
    app: AppHandle,
    c: State<'_, Connectors>,
) -> Result<(), AtlasError> {
    let p = Arc::clone(configured(&c, &id)?);
    match p.info().flow {
        AuthFlow::DeviceCode => {
            let emit = |name: &str, payload: serde_json::Value| {
                let _ = app.emit(name, payload);
            };
            let phase = match device::run(&id, &p.auth_config(), &emit).await? {
                DeviceOutcome::Success(t) => {
                    let account = p.viewer(&t.access_token).await?.login;
                    // Tokens without a refresh token (GitHub) are stored whole.
                    let secret = t.refresh_token.as_ref().unwrap_or(&t.access_token);
                    return c.link(&id, &account, secret);
                }
                DeviceOutcome::Denied => json!({ "phase": "denied" }),
                DeviceOutcome::Expired => json!({ "phase": "expired" }),
                DeviceOutcome::Cancelled => json!({ "phase": "cancelled" }),
                DeviceOutcome::Failed { message } => {
                    json!({ "phase": "failed", "message": message })
                }
            };
            emit("connector://progress", phase);
            Ok(())
        }
        AuthFlow::Browser => Err(not_ready()),
    }
}

#[tauri::command(async)]
pub fn connector_cancel(id: String, c: State<'_, Connectors>) -> Result<(), AtlasError> {
    provider(&c, &id)?;
    device::cancel(&id);
    Ok(())
}

#[tauri::command(async)]
pub fn connector_disconnect(id: String, c: State<'_, Connectors>) -> Result<(), AtlasError> {
    provider(&c, &id)?;
    c.disconnect(&id)
}

#[tauri::command(async)]
pub fn connector_get_ticket(
    connector_id: String,
    ticket_id: String,
    c: State<'_, Connectors>,
) -> Result<Ticket, AtlasError> {
    let _ = ticket_id;
    linked(&c, &connector_id)?;
    Err(not_ready())
}

#[tauri::command(async)]
pub fn connector_list_pull_requests(
    connector_id: String,
    repos: Vec<RepoRef>,
    c: State<'_, Connectors>,
) -> Result<Vec<PullRequest>, AtlasError> {
    let _ = repos;
    linked(&c, &connector_id)?;
    Err(not_ready())
}
