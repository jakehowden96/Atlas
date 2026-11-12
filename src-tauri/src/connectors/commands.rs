//! Tauri commands: linking a connector by one of its `AuthMethod`s, and the
//! reads that use whichever method it was linked with.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use super::oauth::device::{self, DeviceOutcome};
use super::oauth::flow::{run_browser_flow, Tokens};
use super::provider::{
    AuthFlow, AuthMethod, ConnectorProvider, ConnectorState, ConnectorStatus, PullRequest, RepoRef,
    Ticket,
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

/// The provider for `id`, only if it offers `method`.
fn offering<'a>(
    c: &'a Connectors,
    id: &str,
    method: AuthMethod,
) -> Result<&'a Arc<dyn ConnectorProvider>, AtlasError> {
    let p = provider(c, id)?;
    if p.info().methods.contains(&method) {
        Ok(p)
    } else {
        Err(AtlasError::invalid_input(format!(
            "{} cannot sign in that way",
            p.info().name
        )))
    }
}

/// The provider for `id`, only if it is linked. The OAuth client id only
/// matters for signing in, so a CLI or API-key link works without one.
fn linked<'a>(c: &'a Connectors, id: &str) -> Result<&'a Arc<dyn ConnectorProvider>, AtlasError> {
    let p = provider(c, id)?;
    match c.status(id)? {
        ConnectorStatus::Linked { .. } => Ok(p),
        ConnectorStatus::ReconnectNeeded { reason } => {
            Err(AtlasError::ConnectorReconnectNeeded { message: reason })
        }
        ConnectorStatus::NotLinked => Err(AtlasError::ConnectorNotLinked {
            message: format!("{} is not connected", p.info().name),
        }),
    }
}

/// A provider that rejects the saved sign-in flags the connector, so Settings
/// shows the same reconnect state as the screen that hit the 401.
fn flag_rejected<T>(c: &Connectors, id: &str, r: Result<T, AtlasError>) -> Result<T, AtlasError> {
    match r {
        Err(AtlasError::ConnectorReconnectNeeded { message }) => {
            let reason = match c.method(id)? {
                Some(AuthMethod::Cli) => {
                    "The CLI's sign-in was rejected. Sign in with the CLI again, then reconnect."
                        .to_string()
                }
                _ => message,
            };
            Err(c.mark_reconnect(id, &reason)?)
        }
        r => r,
    }
}

/// The account behind `token`, with a rejected token reported as bad input:
/// nothing is linked yet, so there is nothing to reconnect.
async fn account_for(
    p: &Arc<dyn ConnectorProvider>,
    token: &str,
    what: &str,
) -> Result<String, AtlasError> {
    match p.viewer(token).await {
        Ok(v) => Ok(v.login),
        Err(AtlasError::ConnectorReconnectNeeded { .. }) => Err(AtlasError::InvalidInput {
            message: format!("{} rejected {what}", p.info().name),
        }),
        Err(e) => Err(e),
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
    offering(&c, &id, AuthMethod::OAuth)?;
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
    c.link(&id, &account, Some(secret), AuthMethod::OAuth)
}

/// Link `id` with a key the user pasted, for workspaces that block OAuth apps.
#[tauri::command]
pub async fn connector_link_api_key(
    id: String,
    key: String,
    c: State<'_, Connectors>,
) -> Result<(), AtlasError> {
    let p = Arc::clone(offering(&c, &id, AuthMethod::ApiKey)?);
    let key = key.trim();
    if key.is_empty() {
        return Err(AtlasError::invalid_input("Paste an API key"));
    }
    let account = account_for(&p, key, "that key").await?;
    c.link(&id, &account, Some(key), AuthMethod::ApiKey)
}

/// Link `id` through the provider's CLI on this machine. Only the account is
/// stored: each use asks the CLI for its current token.
#[tauri::command]
pub async fn connector_link_cli(id: String, c: State<'_, Connectors>) -> Result<(), AtlasError> {
    let p = Arc::clone(offering(&c, &id, AuthMethod::Cli)?);
    let token = p.cli_token().await?;
    let account = account_for(&p, &token, "the CLI's sign-in").await?;
    c.link(&id, &account, None, AuthMethod::Cli)
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
    flag_rejected(
        &c,
        &connector_id,
        tickets.get_ticket(&token, &ticket_id).await,
    )
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
    flag_rejected(
        &c,
        &connector_id,
        prs.list_pull_requests(&token, &repos).await,
    )
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
    let only = [RepoRef { slug: repo.clone() }];
    let listed = flag_rejected(
        &c,
        &connector_id,
        prs.list_pull_requests(&token, &only).await,
    )?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::tests::setup;

    #[test]
    fn a_method_the_provider_does_not_offer_is_refused() {
        let (c, _d) = setup("cid");
        assert!(offering(&c, "fake", AuthMethod::ApiKey).is_ok());
        assert!(matches!(
            offering(&c, "fake", AuthMethod::Cli),
            Err(AtlasError::InvalidInput { .. })
        ));
    }

    #[test]
    fn a_link_without_an_oauth_client_id_still_reads() {
        let (c, _d) = setup(crate::connectors::clients::PLACEHOLDER);
        c.link("fake", "me", Some("key"), AuthMethod::ApiKey)
            .unwrap();
        assert!(linked(&c, "fake").is_ok());
    }

    #[test]
    fn a_rejected_cli_token_flags_the_connector_with_cli_advice() {
        let (c, _d) = setup("cid");
        c.link("fake", "me", None, AuthMethod::Cli).unwrap();
        let rejected: Result<(), _> = Err(AtlasError::ConnectorReconnectNeeded {
            message: "401".into(),
        });
        let err = flag_rejected(&c, "fake", rejected).unwrap_err();
        assert!(
            matches!(err, AtlasError::ConnectorReconnectNeeded { ref message } if message.contains("CLI"))
        );
        assert!(matches!(
            c.status("fake").unwrap(),
            ConnectorStatus::ReconnectNeeded { .. }
        ));
    }
}
