//! External-service connectors (tickets, pull requests) behind one neutral
//! interface. Everything provider-specific lives behind `ConnectorProvider`;
//! the rest of the app speaks only the types in `provider`.
//!
//! Each connector signs in one way at a time (`AuthMethod`), chosen in
//! Settings and remembered in `connectors.json`. The client ids in `clients`
//! are public OAuth client ids (no secret), safe to commit.

pub mod clients;
pub mod commands;
pub mod config;
pub mod github;
pub mod http;
pub mod keychain;
pub mod linear;
pub mod oauth;
pub mod provider;
pub mod registry;
pub mod tokens;

use crate::error::AtlasError;
use config::ConfigStore;
use keychain::{StoredToken, TokenStore};
use provider::{AuthMethod, ConnectorState, ConnectorStatus};
use registry::Registry;

/// Managed Tauri state: providers, the secret store and the non-secret config.
pub struct Connectors {
    pub registry: Registry,
    tokens: Box<dyn TokenStore>,
    config: ConfigStore,
    access: tokens::AccessCache,
    http: reqwest::Client,
    emitter: std::sync::OnceLock<tokens::Emitter>,
}

impl Connectors {
    pub fn new(registry: Registry, tokens: Box<dyn TokenStore>, config: ConfigStore) -> Self {
        Self {
            registry,
            tokens,
            config,
            access: Default::default(),
            http: http::client(),
            emitter: Default::default(),
        }
    }

    /// Linked means the config remembers it and, for methods that keep a
    /// secret, the keychain still holds it; otherwise it needs a reconnect.
    pub fn status(&self, id: &str) -> Result<ConnectorStatus, AtlasError> {
        let Some(entry) = self.config.load()?.connectors.get(id).cloned() else {
            return Ok(ConnectorStatus::NotLinked);
        };
        if let Some(reason) = self.access.reconnect_reason(id)? {
            return Ok(ConnectorStatus::ReconnectNeeded { reason });
        }
        if entry.method == Some(AuthMethod::Cli) || self.tokens.get(id)?.is_some() {
            return Ok(ConnectorStatus::Linked {
                account: entry.account,
            });
        }
        Ok(ConnectorStatus::ReconnectNeeded {
            reason: "The saved sign-in is missing".to_string(),
        })
    }

    /// How `id` is linked, or `None` when it is not. Entries written before
    /// methods existed are OAuth unless the keychain marks a pasted key.
    pub fn method(&self, id: &str) -> Result<Option<AuthMethod>, AtlasError> {
        let Some(entry) = self.config.load()?.connectors.get(id).cloned() else {
            return Ok(None);
        };
        if let Some(m) = entry.method {
            return Ok(Some(m));
        }
        let legacy_key = self.tokens.get(id)?.is_some_and(|t| t.legacy_api_key);
        Ok(Some(if legacy_key {
            AuthMethod::ApiKey
        } else {
            AuthMethod::OAuth
        }))
    }

    pub fn list(&self) -> Result<Vec<ConnectorState>, AtlasError> {
        self.registry
            .all()
            .map(|p| {
                let info = p.info();
                let status = self.status(&info.id)?;
                let method = self.method(&info.id)?;
                Ok(ConnectorState {
                    info,
                    status,
                    method,
                })
            })
            .collect()
    }

    /// Record a finished sign-in, replacing any earlier one. `secret` is what
    /// the keychain keeps; the CLI method keeps none.
    pub fn link(
        &self,
        id: &str,
        account: &str,
        secret: Option<&str>,
        method: AuthMethod,
    ) -> Result<(), AtlasError> {
        match secret {
            Some(secret) => self.tokens.set(
                id,
                &StoredToken {
                    refresh_token: secret.to_string(),
                    account: account.to_string(),
                    legacy_api_key: false,
                },
            )?,
            None => self.tokens.delete(id)?,
        }
        self.config.update(|c| {
            let entry = c.connectors.entry(id.to_string()).or_default();
            entry.account = account.to_string();
            entry.method = Some(method);
        })?;
        self.access.clear(id)?;
        self.emit_status(id);
        Ok(())
    }

    /// Delete the keychain entry and the config for `id`.
    pub fn disconnect(&self, id: &str) -> Result<(), AtlasError> {
        self.tokens.delete(id)?;
        self.config.update(|c| {
            c.connectors.remove(id);
        })?;
        self.access.clear(id)?;
        self.emit_status(id);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
