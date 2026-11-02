//! Access-token lifecycle: an in-memory cache over the keychain refresh token.
//! Refresh tokens rotate; the new one replaces the stored one before anything
//! else happens. Tokens are never logged or put in events or errors.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::http::{offline, status_error};
use super::keychain::StoredToken;
use super::provider::{AuthFlow, ConnectorStatus};
use super::Connectors;
use crate::error::AtlasError;

/// A cached token with less than this left is refreshed first.
const MIN_REMAINING: Duration = Duration::from_secs(60);
/// Providers whose tokens do not expire omit `expires_in`.
const DEFAULT_LIFETIME: Duration = Duration::from_secs(3600);
const MAX_RETRIES: u32 = 2;
const BACKOFF: Duration = Duration::from_millis(250);

/// Payload of the `connector://status` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatusEvent {
    pub connector: String,
    pub status: ConnectorStatus,
}

pub type Emitter = Box<dyn Fn(&StatusEvent) + Send + Sync>;

#[derive(Default)]
pub struct AccessCache {
    tokens: Mutex<HashMap<String, (String, Instant)>>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Connectors whose refresh token was rejected, with the reason shown.
    reconnect: Mutex<HashMap<String, String>>,
}

impl AccessCache {
    fn cached(&self, id: &str) -> Result<Option<String>, AtlasError> {
        Ok(self
            .tokens
            .lock()?
            .get(id)
            .filter(|(_, exp)| exp.saturating_duration_since(Instant::now()) > MIN_REMAINING)
            .map(|(t, _)| t.clone()))
    }

    pub fn forget(&self, id: &str) -> Result<(), AtlasError> {
        self.tokens.lock()?.remove(id);
        Ok(())
    }

    pub fn reconnect_reason(&self, id: &str) -> Result<Option<String>, AtlasError> {
        Ok(self.reconnect.lock()?.get(id).cloned())
    }

    pub fn clear(&self, id: &str) -> Result<(), AtlasError> {
        self.forget(id)?;
        self.reconnect.lock()?.remove(id);
        Ok(())
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct OAuthError {
    error: Option<String>,
}

impl Connectors {
    /// A valid access token for `id`, refreshing if needed. Concurrent callers
    /// share one refresh.
    pub async fn access_token(&self, id: &str) -> Result<String, AtlasError> {
        if let Some(t) = self.access.cached(id)? {
            return Ok(t);
        }
        let lock = self
            .access
            .locks
            .lock()?
            .entry(id.to_string())
            .or_default()
            .clone();
        let _guard = lock.lock().await;
        if let Some(t) = self.access.cached(id)? {
            return Ok(t);
        }
        self.refresh(id).await
    }

    async fn refresh(&self, id: &str) -> Result<String, AtlasError> {
        if let Some(message) = self.access.reconnect_reason(id)? {
            return Err(AtlasError::ConnectorReconnectNeeded { message });
        }
        let provider = self
            .registry
            .get(id)
            .ok_or_else(|| AtlasError::not_found(format!("No connector named {id}")))?;
        let stored = self
            .tokens
            .get(id)?
            .ok_or_else(|| AtlasError::ConnectorNotLinked {
                message: format!("{} is not connected", provider.info().name),
            })?;
        // shortcut: device-flow tokens (GitHub) do not expire and are stored whole, so there is nothing to refresh; revisit if a device-flow provider issues refresh tokens.
        if provider.info().flow == AuthFlow::DeviceCode {
            return Ok(stored.refresh_token);
        }
        let cfg = provider.auth_config();
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "refresh_token")
            .append_pair("refresh_token", &stored.refresh_token)
            .append_pair("client_id", &cfg.client_id)
            .finish();

        let mut attempt = 0;
        let resp = loop {
            let resp = self
                .http
                .post(&cfg.token_url)
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .header(ACCEPT, "application/json")
                .body(body.clone())
                .send()
                .await
                // The server may have accepted and lost the reply; the old
                // refresh token is still stored, so the next call retries it.
                .map_err(|_| offline())?;
            let status = resp.status();
            if status.is_success() {
                break resp;
            }
            if matches!(status.as_u16(), 400 | 401) {
                let headers = resp.headers().clone();
                let invalid = resp
                    .json::<OAuthError>()
                    .await
                    .ok()
                    .and_then(|e| e.error)
                    .is_some_and(|e| e == "invalid_grant");
                if invalid {
                    return Err(self.mark_reconnect(id, "The sign-in has expired")?);
                }
                return Err(status_error(status, &headers));
            }
            if status.is_server_error() && attempt < MAX_RETRIES {
                tokio::time::sleep(BACKOFF * 2u32.pow(attempt)).await;
                attempt += 1;
                continue;
            }
            return Err(status_error(status, resp.headers()));
        };

        let parsed: TokenResponse = resp
            .json()
            .await
            .map_err(|_| AtlasError::parse("The service sent an unreadable token response"))?;
        // Persist the rotated refresh token before using the new access token.
        if let Some(next) = parsed.refresh_token.filter(|r| *r != stored.refresh_token) {
            self.tokens.set(
                id,
                &StoredToken {
                    refresh_token: next,
                    account: stored.account,
                },
            )?;
        }
        let lifetime = parsed
            .expires_in
            .map_or(DEFAULT_LIFETIME, Duration::from_secs);
        self.access.tokens.lock()?.insert(
            id.to_string(),
            (parsed.access_token.clone(), Instant::now() + lifetime),
        );
        Ok(parsed.access_token)
    }

    /// Flag `id` as needing a sign-in; emits once per transition.
    fn mark_reconnect(&self, id: &str, reason: &str) -> Result<AtlasError, AtlasError> {
        self.access.forget(id)?;
        let first = self
            .access
            .reconnect
            .lock()?
            .insert(id.to_string(), reason.to_string())
            .is_none();
        if first {
            self.emit_status(id);
        }
        Ok(AtlasError::ConnectorReconnectNeeded {
            message: reason.to_string(),
        })
    }

    pub fn set_emitter(&self, emitter: Emitter) {
        let _ = self.emitter.set(emitter);
    }

    pub(super) fn emit_status(&self, id: &str) {
        if let (Some(emit), Ok(status)) = (self.emitter.get(), self.status(id)) {
            emit(&StatusEvent {
                connector: id.to_string(),
                status,
            });
        }
    }
}

#[cfg(test)]
#[path = "tokens_tests.rs"]
mod tests;
