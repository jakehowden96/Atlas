use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use serde_json::json;
use wiremock::matchers::{body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::connectors::config::ConfigStore;
use crate::connectors::http::now_secs;
use crate::connectors::keychain::MemoryStore;
use crate::connectors::provider::*;
use crate::connectors::registry::Registry;

struct Fake {
    token_url: String,
}

#[async_trait]
impl ConnectorProvider for Fake {
    fn info(&self) -> ConnectorInfo {
        ConnectorInfo {
            id: "fake".into(),
            name: "Fake".into(),
            kind: ConnectorKind::Tickets,
            flow: AuthFlow::Browser,
            configured: true,
        }
    }
    fn auth_config(&self) -> AuthConfig {
        AuthConfig {
            client_id: "cid".into(),
            scopes: vec![],
            auth_url: String::new(),
            token_url: self.token_url.clone(),
            redirect_ports: vec![],
            device_auth_url: None,
        }
    }
    async fn viewer(&self, _token: &str) -> Result<Viewer, AtlasError> {
        unreachable!()
    }
}

fn setup(token_url: String) -> (Connectors, Arc<AtomicUsize>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let mut registry = Registry::default();
    registry.register(Arc::new(Fake { token_url }));
    let c = Connectors::new(
        registry,
        Box::new(MemoryStore::default()),
        ConfigStore::new(Some(dir.path().to_path_buf())),
    );
    c.link("fake", "me", "r1").unwrap();
    let events = Arc::new(AtomicUsize::new(0));
    let n = events.clone();
    c.set_emitter(Box::new(move |_| {
        n.fetch_add(1, Ordering::SeqCst);
    }));
    (c, events, dir)
}

fn ok(access: &str, refresh: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(
        json!({ "access_token": access, "refresh_token": refresh, "expires_in": 3600 }),
    )
}

fn stored(c: &Connectors) -> String {
    c.tokens.get("fake").unwrap().unwrap().refresh_token
}

#[tokio::test]
async fn refresh_rotates_the_stored_token_and_caches_the_access_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("refresh_token=r1"))
        .respond_with(ok("a1", "r2"))
        .expect(1)
        .mount(&server)
        .await;
    let (c, _, _d) = setup(format!("{}/token", server.uri()));
    assert_eq!(c.access_token("fake").await.unwrap(), "a1");
    assert_eq!(c.access_token("fake").await.unwrap(), "a1");
    assert_eq!(stored(&c), "r2");
}

#[tokio::test]
async fn concurrent_callers_share_one_refresh() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ok("a1", "r2").set_delay(Duration::from_millis(100)))
        .expect(1)
        .mount(&server)
        .await;
    let (c, _, _d) = setup(format!("{}/token", server.uri()));
    let (a, b, d) = tokio::join!(
        c.access_token("fake"),
        c.access_token("fake"),
        c.access_token("fake")
    );
    assert_eq!([a.unwrap(), b.unwrap(), d.unwrap()], ["a1", "a1", "a1"]);
}

#[tokio::test]
async fn a_transient_failure_is_retried_with_the_same_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(body_string_contains("refresh_token=r1"))
        .respond_with(ok("a1", "r2"))
        .mount(&server)
        .await;
    let (c, _, _d) = setup(format!("{}/token", server.uri()));
    assert_eq!(c.access_token("fake").await.unwrap(), "a1");
    assert_eq!(stored(&c), "r2");
}

#[tokio::test]
async fn invalid_grant_flips_status_and_emits_once() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": "invalid_grant" })))
        .mount(&server)
        .await;
    let (c, events, _d) = setup(format!("{}/token", server.uri()));
    for _ in 0..2 {
        assert!(matches!(
            c.access_token("fake").await,
            Err(AtlasError::ConnectorReconnectNeeded { .. })
        ));
    }
    assert!(matches!(
        c.status("fake").unwrap(),
        ConnectorStatus::ReconnectNeeded { .. }
    ));
    assert_eq!(events.load(Ordering::SeqCst), 1);
    assert_eq!(stored(&c), "r1");
}

#[tokio::test]
async fn rate_limit_carries_retry_at() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "120"))
        .mount(&server)
        .await;
    let (c, _, _d) = setup(format!("{}/token", server.uri()));
    let Err(AtlasError::ConnectorRateLimited { retry_at, .. }) = c.access_token("fake").await
    else {
        panic!("expected rate limit");
    };
    let now = now_secs();
    assert!((now + 118..=now + 122).contains(&retry_at));
}

#[tokio::test]
async fn offline_does_not_unlink() {
    let (c, events, _d) = setup("http://127.0.0.1:9/token".into());
    assert!(matches!(
        c.access_token("fake").await,
        Err(AtlasError::ConnectorOffline { .. })
    ));
    assert!(matches!(
        c.status("fake").unwrap(),
        ConnectorStatus::Linked { .. }
    ));
    assert_eq!(stored(&c), "r1");
    assert_eq!(events.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn authorized_client_refreshes_once_after_a_401() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ok("a1", "r2"))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/data"))
        .and(header("authorization", "Bearer a1"))
        .respond_with(ResponseTemplate::new(401))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/data"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "n": 1 })))
        .mount(&server)
        .await;
    let (c, _, _d) = setup(format!("{}/token", server.uri()));
    let v: serde_json::Value = c
        .authorized()
        .get("fake", &format!("{}/data", server.uri()))
        .await
        .unwrap();
    assert_eq!(v["n"], 1);
}
