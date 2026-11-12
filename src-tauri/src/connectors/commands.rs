//! Tauri commands. The sign-in flows are stubs until their phases land.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use super::oauth::device::{self, DeviceOutcome};
use super::oauth::flow::{run_browser_flow, Tokens};
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

fn unsupported(p: &Arc<dyn ConnectorProvider>) -> AtlasError {
    AtlasError::not_found(format!("{} does not support this", p.info().name))
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
    let p = Arc::clone(configured(&c, &id)?);
    let tokens = match p.info().flow {
        AuthFlow::DeviceCode => {
            let emit = |name: &str, payload: serde_json::Value| {
                let _ = app.emit(name, payload);
            };
            let phase = match device::run(&id, &p.auth_config(), &emit).await? {
                DeviceOutcome::Success(t) => t,
                DeviceOutcome::Denied => return progress_end(&app, json!({ "phase": "denied" })),
                DeviceOutcome::Expired => return progress_end(&app, json!({ "phase": "expired" })),
                DeviceOutcome::Cancelled => {
                    return progress_end(&app, json!({ "phase": "cancelled" }))
                }
                DeviceOutcome::Failed { message } => {
                    return progress_end(&app, json!({ "phase": "failed", "message": message }))
                }
            };
            phase
        }
        AuthFlow::Browser => browser_tokens(&p, &id, &app).await?,
    };
    // GitHub device tokens carry no refresh token: the access token is stored whole.
    let secret = tokens.refresh.as_ref().unwrap_or(&tokens.access);
    let account = p.viewer(&tokens.access).await?.login;
    c.link(&id, &account, secret, false)
}

/// Link `id` with a key the user pasted, for workspaces that block OAuth apps.
#[tauri::command]
pub async fn connector_link_api_key(
    id: String,
    key: String,
    c: State<'_, Connectors>,
) -> Result<(), AtlasError> {
    let p = Arc::clone(provider(&c, &id)?);
    let key = key.trim();
    if key.is_empty() {
        return Err(AtlasError::InvalidInput {
            message: "Paste an API key".into(),
        });
    }
    let account = match p.viewer(key).await {
        Ok(v) => v.login,
        Err(AtlasError::ConnectorReconnectNeeded { .. }) => {
            return Err(AtlasError::InvalidInput {
                message: format!("{} rejected that key", p.info().name),
            })
        }
        Err(e) => return Err(e),
    };
    c.link(&id, &account, key, true)
}

fn progress_end(app: &AppHandle, payload: serde_json::Value) -> Result<(), AtlasError> {
    let _ = app.emit("connector://progress", payload);
    Ok(())
}

async fn browser_tokens(
    p: &Arc<dyn ConnectorProvider>,
    id: &str,
    app: &AppHandle,
) -> Result<Tokens, AtlasError> {
    let (tx, rx) = oneshot::channel();
    // A second connect for the same id drops the older sender, cancelling it.
    PENDING
        .lock()?
        .get_or_insert_default()
        .insert(id.to_string(), tx);
    let progress = |phase: &str| {
        let _ = app.emit(
            "connector://progress",
            serde_json::json!({ "connector": id, "phase": phase }),
        );
    };
    let open = |url: &str| {
        super::super::commands::url::browser_launcher(url)
            .spawn()
            .map(drop)
            .map_err(|e| AtlasError::tool_failed("browser", format!("Failed to open URL: {e}")))
    };
    let result = run_browser_flow(&p.auth_config(), rx, progress, open).await;
    PENDING.lock()?.get_or_insert_default().remove(id);
    let tokens = result?;
    if tokens.refresh.is_none() {
        return Err(AtlasError::ConnectorRemote {
            message: "The service sent no refresh token".to_string(),
            status: 200,
        });
    }
    Ok(tokens)
}

#[tauri::command(async)]
pub fn connector_cancel(id: String, c: State<'_, Connectors>) -> Result<(), AtlasError> {
    provider(&c, &id)?;
    if let Some(tx) = PENDING.lock()?.get_or_insert_default().remove(&id) {
        let _ = tx.send(());
    }
    device::cancel(&id);
    Ok(())
}

#[tauri::command(async)]
pub fn connector_disconnect(id: String, c: State<'_, Connectors>) -> Result<(), AtlasError> {
    provider(&c, &id)?;
    c.disconnect(&id)
}

#[tauri::command]
pub async fn connector_get_ticket(
    connector_id: String,
    ticket_id: String,
    c: State<'_, Connectors>,
) -> Result<Ticket, AtlasError> {
    let p = Arc::clone(linked(&c, &connector_id)?);
    let tickets = p.tickets().ok_or_else(|| unsupported(&p))?;
    let token = c.access_token(&connector_id).await?;
    tickets.get_ticket(&token, &ticket_id).await
}

#[tauri::command]
pub async fn connector_list_pull_requests(
    connector_id: String,
    repos: Vec<RepoRef>,
    c: State<'_, Connectors>,
) -> Result<Vec<PullRequest>, AtlasError> {
    let p = Arc::clone(linked(&c, &connector_id)?);
    let prs = p.pull_requests().ok_or_else(|| unsupported(&p))?;
    let token = c.access_token(&connector_id).await?;
    prs.list_pull_requests(&token, &repos).await
}

/// Check out pull request `number` of `repo` in `cwd` with the user's own git.
#[tauri::command]
pub async fn connector_checkout_pull_request(
    connector_id: String,
    cwd: String,
    repo: String,
    number: u32,
    c: State<'_, Connectors>,
) -> Result<(), AtlasError> {
    let p = Arc::clone(linked(&c, &connector_id)?);
    let prs = p.pull_requests().ok_or_else(|| unsupported(&p))?;
    let token = c.access_token(&connector_id).await?;
    let listed = prs
        .list_pull_requests(&token, &[RepoRef { slug: repo.clone() }])
        .await?;
    // A PR missing from the open list is treated as a fork: no upstream is set.
    let (head, cross) = listed
        .iter()
        .find(|pr| pr.number == number)
        .map_or((None, true), |pr| {
            (Some(pr.head_ref_name.clone()), pr.is_cross_repository)
        });
    tokio::task::spawn_blocking(move || {
        super::github::checkout::checkout_pull_request(&cwd, &repo, number, head.as_deref(), cross)
    })
    .await
    .map_err(|e| AtlasError::internal(e.to_string()))?
}
