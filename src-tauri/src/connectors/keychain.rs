//! Refresh tokens in the OS keychain. Service `atlas`, user `<connector-id>`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::AtlasError;

const SERVICE: &str = "atlas";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredToken {
    /// The refresh token, or the access token / key itself when the method
    /// has nothing to refresh.
    pub refresh_token: String,
    pub account: String,
    /// Read only, to recover the method of links made before
    /// `ConnectorEntry::method` existed.
    #[serde(default, rename = "api_key", skip_serializing)]
    pub legacy_api_key: bool,
}

pub trait TokenStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<StoredToken>, AtlasError>;
    fn set(&self, id: &str, token: &StoredToken) -> Result<(), AtlasError>;
    /// Deleting an entry that does not exist succeeds.
    fn delete(&self, id: &str) -> Result<(), AtlasError>;
}

/// Caches what it reads: on macOS each keychain read of an unsigned (or
/// re-signed) build can raise a password prompt, so read each entry once.
#[derive(Default)]
pub struct KeyringStore(Mutex<HashMap<String, Option<StoredToken>>>);

fn entry(id: &str) -> Result<keyring::Entry, AtlasError> {
    keyring::Entry::new(SERVICE, id).map_err(map_err)
}

fn map_err(e: keyring::Error) -> AtlasError {
    AtlasError::internal(format!("keychain: {e}"))
}

impl TokenStore for KeyringStore {
    fn get(&self, id: &str) -> Result<Option<StoredToken>, AtlasError> {
        if let Some(hit) = self.0.lock()?.get(id) {
            return Ok(hit.clone());
        }
        // Errors (a denied prompt) are not cached, so the next read asks again.
        let token = match entry(id)?.get_password() {
            Ok(json) => Some(serde_json::from_str(&json)?),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => return Err(map_err(e)),
        };
        self.0.lock()?.insert(id.to_string(), token.clone());
        Ok(token)
    }

    fn set(&self, id: &str, token: &StoredToken) -> Result<(), AtlasError> {
        entry(id)?
            .set_password(&serde_json::to_string(token)?)
            .map_err(map_err)?;
        self.0.lock()?.insert(id.to_string(), Some(token.clone()));
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), AtlasError> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(map_err(e)),
        }
        self.0.lock()?.insert(id.to_string(), None);
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    // The mock keyring forgets everything between `Entry`s, so a value read
    // back after `set` can only have come from the cache.
    #[test]
    fn keyring_reads_are_cached() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let store = KeyringStore::default();
        let token = StoredToken {
            refresh_token: "r".into(),
            account: "a".into(),
            legacy_api_key: false,
        };
        assert_eq!(store.get("x").unwrap(), None);
        store.set("x", &token).unwrap();
        assert_eq!(store.get("x").unwrap(), Some(token));
        store.delete("x").unwrap();
        assert_eq!(store.get("x").unwrap(), None);
    }
}
