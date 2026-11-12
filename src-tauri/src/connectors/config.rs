//! Non-secret connector state in `~/.atlas/connectors.json`.
//!
//! Kept out of `StateFile` on purpose: that set is what the webview may load
//! and save, and the account labels here are written only by Rust.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::provider::AuthMethod;
use crate::error::AtlasError;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConnectorEntry {
    pub account: String,
    /// `None` in files written before methods existed; see `Connectors::method`.
    pub method: Option<AuthMethod>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConnectorsConfig {
    pub version: u32,
    pub connectors: BTreeMap<String, ConnectorEntry>,
}

impl Default for ConnectorsConfig {
    fn default() -> Self {
        Self {
            version: 1,
            connectors: BTreeMap::new(),
        }
    }
}

pub struct ConfigStore {
    path: Option<PathBuf>,
    /// Serialises read-modify-write.
    lock: Mutex<()>,
}

impl ConfigStore {
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self {
            path: dir.map(|d| d.join("connectors.json")),
            lock: Mutex::new(()),
        }
    }

    fn path(&self) -> Result<&PathBuf, AtlasError> {
        self.path
            .as_ref()
            .ok_or_else(|| AtlasError::internal("Could not resolve the home directory"))
    }

    /// A missing or unreadable file is an empty config.
    pub fn load(&self) -> Result<ConnectorsConfig, AtlasError> {
        let bytes = match std::fs::read(self.path()?) {
            Ok(b) => b,
            Err(_) => return Ok(ConnectorsConfig::default()),
        };
        Ok(serde_json::from_slice(&bytes).unwrap_or_default())
    }

    pub fn update(&self, change: impl FnOnce(&mut ConnectorsConfig)) -> Result<(), AtlasError> {
        let _held = self.lock.lock()?;
        let path = self.path()?;
        let mut config = self.load()?;
        change(&mut config);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AtlasError::io_at(dir, &e))?;
        }
        crate::atomic_write::write_atomic(path, serde_json::to_string_pretty(&config)?.as_bytes())
            .map_err(|e| AtlasError::io_at(path, &e))
    }
}
