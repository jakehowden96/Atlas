use std::sync::Arc;

use async_trait::async_trait;

use super::clients::{is_configured, PLACEHOLDER};
use super::config::ConfigStore;
use super::keychain::MemoryStore;
use super::provider::*;
use super::registry::Registry;
use super::Connectors;
use crate::error::AtlasError;

struct FakeProvider {
    client_id: &'static str,
}

#[async_trait]
impl ConnectorProvider for FakeProvider {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "fake".into(),
            name: "Fake".into(),
            kind: ConnectorKind::Tickets,
            flow: AuthFlow::Browser,
            configured: is_configured(self.client_id),
        }
    }
    fn auth_config(&self) -> AuthConfig {
        AuthConfig {
            client_id: self.client_id.into(),
            scopes: vec![],
            auth_url: "https://example.test/auth".into(),
            token_url: "https://example.test/token".into(),
            redirect_ports: vec![],
            device_auth_url: None,
        }
    }
    async fn viewer(&self, _token: &str) -> Result<Viewer, AtlasError> {
        Ok(Viewer {
            login: "me".into(),
            name: None,
        })
    }
}

fn setup(client_id: &'static str) -> (Connectors, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let mut registry = Registry::default();
    registry.register(Arc::new(FakeProvider { client_id }));
    let c = Connectors::new(
        registry,
        Box::new(MemoryStore::default()),
        ConfigStore::new(Some(dir.path().to_path_buf())),
    );
    (c, dir)
}

#[test]
fn an_empty_registry_lists_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let c = Connectors::new(
        Registry::default(),
        Box::new(MemoryStore::default()),
        ConfigStore::new(Some(dir.path().to_path_buf())),
    );
    assert!(c.list().unwrap().is_empty());
}

#[test]
fn placeholder_client_id_is_not_configured() {
    assert!(!is_configured(PLACEHOLDER));
    assert!(is_configured("abc123"));
    let (c, _dir) = setup(PLACEHOLDER);
    assert!(!c.list().unwrap()[0].info.configured);
}

#[test]
fn link_then_disconnect_moves_status_and_clears_the_store() {
    let (c, dir) = setup("abc");
    assert_eq!(c.status("fake").unwrap(), ConnectorStatus::NotLinked);

    c.link("fake", "me@example.test", "refresh", false).unwrap();
    assert_eq!(
        c.status("fake").unwrap(),
        ConnectorStatus::Linked {
            account: "me@example.test".into()
        }
    );
    assert!(dir.path().join("connectors.json").exists());

    c.disconnect("fake").unwrap();
    assert_eq!(c.status("fake").unwrap(), ConnectorStatus::NotLinked);
    assert!(c.tokens.get("fake").unwrap().is_none());
    assert!(c.config.load().unwrap().connectors.is_empty());
}

#[test]
fn a_missing_token_means_reconnect_needed() {
    let (c, _dir) = setup("abc");
    c.link("fake", "me", "refresh", false).unwrap();
    c.tokens.delete("fake").unwrap();
    assert!(matches!(
        c.status("fake").unwrap(),
        ConnectorStatus::ReconnectNeeded { .. }
    ));
}

#[test]
fn status_serialises_with_a_kind_tag() {
    let v = serde_json::to_value(ConnectorStatus::Linked {
        account: "a".into(),
    })
    .unwrap();
    assert_eq!(v, serde_json::json!({ "kind": "linked", "account": "a" }));
}
