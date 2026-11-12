use std::sync::Arc;

use async_trait::async_trait;

use super::clients::{is_configured, PLACEHOLDER};
use super::config::ConfigStore;
use super::keychain::{MemoryStore, StoredToken};
use super::provider::*;
use super::registry::Registry;
use super::Connectors;
use crate::error::AtlasError;

struct FakeProvider {
    client_id: &'static str,
    /// What `cli_token` answers: a token, or the reason it cannot.
    cli: Result<&'static str, &'static str>,
}

#[async_trait]
impl ConnectorProvider for FakeProvider {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "fake".into(),
            name: "Fake".into(),
            kind: ConnectorKind::Tickets,
            flow: AuthFlow::Browser,
            methods: vec![AuthMethod::OAuth, AuthMethod::ApiKey],
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
    async fn cli_token(&self) -> Result<String, AtlasError> {
        self.cli
            .map(str::to_string)
            .map_err(|m| AtlasError::ConnectorReconnectNeeded { message: m.into() })
    }
}

pub(super) fn setup(client_id: &'static str) -> (Connectors, tempfile::TempDir) {
    setup_cli(client_id, Ok("cli-tok"))
}

fn setup_cli(
    client_id: &'static str,
    cli: Result<&'static str, &'static str>,
) -> (Connectors, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let mut registry = Registry::default();
    registry.register(Arc::new(FakeProvider { client_id, cli }));
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

    c.link(
        "fake",
        "me@example.test",
        Some("refresh"),
        AuthMethod::OAuth,
    )
    .unwrap();
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
    c.link("fake", "me", Some("refresh"), AuthMethod::OAuth)
        .unwrap();
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

#[test]
fn a_cli_link_keeps_no_secret_and_reports_its_method() {
    let (c, _dir) = setup("abc");
    c.link("fake", "me", Some("old"), AuthMethod::OAuth)
        .unwrap();
    c.link("fake", "me", None, AuthMethod::Cli).unwrap();
    assert!(c.tokens.get("fake").unwrap().is_none());
    let state = &c.list().unwrap()[0];
    assert_eq!(
        state.status,
        ConnectorStatus::Linked {
            account: "me".into()
        }
    );
    assert_eq!(state.method, Some(AuthMethod::Cli));
}

#[test]
fn links_from_before_methods_resolve_from_the_keychain() {
    let (c, _dir) = setup("abc");
    assert_eq!(c.method("fake").unwrap(), None);
    // What an older Atlas wrote: an account but no method.
    c.config
        .update(|cfg| {
            cfg.connectors.entry("fake".into()).or_default().account = "me".into();
        })
        .unwrap();
    let token = |legacy_api_key| StoredToken {
        refresh_token: "k".into(),
        account: "me".into(),
        legacy_api_key,
    };
    c.tokens.set("fake", &token(true)).unwrap();
    assert_eq!(c.method("fake").unwrap(), Some(AuthMethod::ApiKey));
    c.tokens.set("fake", &token(false)).unwrap();
    assert_eq!(c.method("fake").unwrap(), Some(AuthMethod::OAuth));
}

#[test]
fn the_legacy_api_key_flag_is_read_but_never_written() {
    let old: StoredToken =
        serde_json::from_str(r#"{"refresh_token":"k","account":"me","api_key":true}"#).unwrap();
    assert!(old.legacy_api_key);
    assert!(!serde_json::to_string(&old).unwrap().contains("api_key"));
}

#[tokio::test]
async fn a_cli_link_asks_the_cli_for_each_token() {
    let (c, _dir) = setup("abc");
    c.link("fake", "me", None, AuthMethod::Cli).unwrap();
    assert_eq!(c.access_token("fake").await.unwrap(), "cli-tok");
}

#[tokio::test]
async fn a_signed_out_cli_flags_reconnect() {
    let (c, _dir) = setup_cli("abc", Err("Run gh auth login"));
    c.link("fake", "me", None, AuthMethod::Cli).unwrap();
    assert!(matches!(
        c.access_token("fake").await,
        Err(AtlasError::ConnectorReconnectNeeded { .. })
    ));
    assert_eq!(
        c.status("fake").unwrap(),
        ConnectorStatus::ReconnectNeeded {
            reason: "Run gh auth login".into()
        }
    );
}
