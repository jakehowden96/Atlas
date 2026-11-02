//! Tauri commands. The sign-in flows are stubs until their phases land.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use super::oauth::flow::run_browser_flow;
use super::provider::{
    ConnectorProvider, ConnectorState, ConnectorStatus, PullRequest, RepoRef, Ticket,
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

/// Cancel handles of the sign-ins in progress, by connector id.
static PENDING: Mutex<Option<HashMap<String, oneshot::Sender<()>>>> = Mutex::new(None);

#[tauri::command]
pub async fn connector_connect(
    id: String,
    app: AppHandle,
    c: State<'_, Connectors>,
) -> Result<(), AtlasError> {
    let p = configured(&c, &id)?.clone();
    let (tx, rx) = oneshot::channel();
    // A second connect for the same id drops the older sender, cancelling it.
    PENDING
        .lock()?
        .get_or_insert_default()
        .insert(id.clone(), tx);
    let progress = |phase: &str| {
        let _ = app.emit(
            "connector://progress",
            serde_json::json!({ "connector": id, "phase": phase }),
        );
    };
    let open = |url: &str| {
        super::super::commands::prs::browser_launcher(url)
            .spawn()
            .map(drop)
            .map_err(|e| AtlasError::tool_failed("browser", format!("Failed to open URL: {e}")))
    };
    let result = run_browser_flow(&p.auth_config(), rx, progress, open).await;
    PENDING.lock()?.get_or_insert_default().remove(&id);
    let tokens = result?;
    let refresh = tokens.refresh.ok_or_else(|| AtlasError::ConnectorRemote {
        message: "The service sent no refresh token".to_string(),
        status: 200,
    })?;
    let account = p.viewer(&tokens.access).await?.login;
    c.link(&id, &account, &refresh)
}

#[tauri::command(async)]
pub fn connector_cancel(id: String, c: State<'_, Connectors>) -> Result<(), AtlasError> {
    provider(&c, &id)?;
    if let Some(tx) = PENDING.lock()?.get_or_insert_default().remove(&id) {
        let _ = tx.send(());
    }
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
