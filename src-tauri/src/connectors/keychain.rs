//! Refresh tokens in the OS keychain. Service `atlas`, user `<connector-id>`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::AtlasError;

const SERVICE: &str = "atlas";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredToken {
    pub refresh_token: String,
    pub account: String,
}

pub trait TokenStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<StoredToken>, AtlasError>;
    fn set(&self, id: &str, token: &StoredToken) -> Result<(), AtlasError>;
    /// Deleting an entry that does not exist succeeds.
    fn delete(&self, id: &str) -> Result<(), AtlasError>;
}

pub struct KeyringStore;

fn entry(id: &str) -> Result<keyring::Entry, AtlasError> {
    keyring::Entry::new(SERVICE, id).map_err(map_err)
}

fn map_err(e: keyring::Error) -> AtlasError {
    AtlasError::internal(format!("keychain: {e}"))
}

impl TokenStore for KeyringStore {
    fn get(&self, id: &str) -> Result<Option<StoredToken>, AtlasError> {
        match entry(id)?.get_password() {
            Ok(json) => Ok(Some(serde_json::from_str(&json)?)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(map_err(e)),
        }
    }

    fn set(&self, id: &str, token: &StoredToken) -> Result<(), AtlasError> {
        entry(id)?
            .set_password(&serde_json::to_string(token)?)
            .map_err(map_err)
    }

    fn delete(&self, id: &str) -> Result<(), AtlasError> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map_err(e)),
        }
    }
}

#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, StoredToken>>);

impl TokenStore for MemoryStore {
    fn get(&self, id: &str) -> Result<Option<StoredToken>, AtlasError> {
        Ok(self.0.lock()?.get(id).cloned())
    }
    fn set(&self, id: &str, token: &StoredToken) -> Result<(), AtlasError> {
        self.0.lock()?.insert(id.to_string(), token.clone());
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), AtlasError> {
        self.0.lock()?.remove(id);
        Ok(())
    }
}
