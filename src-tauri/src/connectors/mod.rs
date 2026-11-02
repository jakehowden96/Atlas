//! External-service connectors (tickets, pull requests) behind one neutral
//! interface. Everything provider-specific lives behind `ConnectorProvider`;
//! the rest of the app speaks only the types in `provider`.
//!
//! The client ids in `clients` are public OAuth client ids (no secret), safe to
//! commit. The user registers the apps and replaces the placeholders.

pub mod clients;
pub mod commands;
pub mod config;
pub mod keychain;
pub mod oauth;
pub mod provider;
pub mod registry;

use crate::error::AtlasError;
use config::ConfigStore;
use keychain::{StoredToken, TokenStore};
use provider::{ConnectorState, ConnectorStatus};
use registry::Registry;

/// Managed Tauri state: providers, the secret store and the non-secret config.
pub struct Connectors {
    pub registry: Registry,
    tokens: Box<dyn TokenStore>,
    config: ConfigStore,
}

impl Connectors {
    pub fn new(registry: Registry, tokens: Box<dyn TokenStore>, config: ConfigStore) -> Self {
        Self {
            registry,
            tokens,
            config,
        }
    }

    /// Linked means the config remembers it and the keychain still holds the
    /// refresh token; a config entry without a token needs a reconnect.
    pub fn status(&self, id: &str) -> Result<ConnectorStatus, AtlasError> {
        let Some(entry) = self.config.load()?.connectors.get(id).cloned() else {
            return Ok(ConnectorStatus::NotLinked);
        };
        Ok(match self.tokens.get(id)? {
            Some(_) => ConnectorStatus::Linked {
                account: entry.account,
            },
            None => ConnectorStatus::ReconnectNeeded {
                reason: "The saved sign-in is missing".to_string(),
            },
        })
    }

    pub fn list(&self) -> Result<Vec<ConnectorState>, AtlasError> {
        self.registry
            .all()
            .map(|p| {
                let info = p.info();
                let status = self.status(&info.id)?;
                Ok(ConnectorState { info, status })
            })
            .collect()
    }

    /// Record a finished sign-in. Called by the flows added in later phases.
    pub fn link(&self, id: &str, account: &str, refresh_token: &str) -> Result<(), AtlasError> {
        self.tokens.set(
            id,
            &StoredToken {
                refresh_token: refresh_token.to_string(),
                account: account.to_string(),
            },
        )?;
        self.config.update(|c| {
            c.connectors.entry(id.to_string()).or_default().account = account.to_string();
        })
    }

    /// Delete the keychain entry and the config for `id`.
    pub fn disconnect(&self, id: &str) -> Result<(), AtlasError> {
        self.tokens.delete(id)?;
        self.config.update(|c| {
            c.connectors.remove(id);
        })
    }
}

#[cfg(test)]
mod tests;
