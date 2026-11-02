//! OAuth device authorization flow (RFC 8628): request a code, show it to the
//! user, poll the token endpoint until they approve, deny or it expires.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Notify;
use ts_rs::TS;

use super::flow::Tokens;
use crate::connectors::provider::AuthConfig;
use crate::error::AtlasError;

const SLOW_DOWN_STEP: Duration = Duration::from_secs(5);
const DEFAULT_INTERVAL: u64 = 5;

/// Sent to the UI as `connector://device-code`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

/// How a device flow ended. Network failures are `Err(ConnectorOffline)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceOutcome {
    Success(Tokens),
    Denied,
    Expired,
    Failed { message: String },
    Cancelled,
}

#[derive(Deserialize)]
struct CodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn cancels() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();
    CANCELS.get_or_init(Default::default)
}

/// Stop a running device flow for connector `id`, if any.
pub fn cancel(id: &str) {
    if let Some(n) = cancels().lock().ok().and_then(|m| m.get(id).cloned()) {
        n.notify_one();
    }
}

fn offline(e: reqwest::Error) -> AtlasError {
    AtlasError::ConnectorOffline {
        message: format!("Could not reach the sign-in service: {e}"),
    }
}

fn unexpected(what: &str, e: serde_json::Error) -> AtlasError {
    AtlasError::ConnectorRemote {
        message: format!("Unexpected {what} response: {e}"),
        status: 0,
    }
}

async fn post_form(
    client: &reqwest::Client,
    url: &str,
    fields: &[(&str, &str)],
) -> Result<Value, AtlasError> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish();
    let res = client
        .post(url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(offline)?;
    // OAuth errors arrive as 4xx JSON bodies, so the status is not checked.
    res.json().await.map_err(offline)
}

/// Run the whole flow for connector `id`, emitting through `emit`.
pub async fn run(
    id: &str,
    cfg: &AuthConfig,
    emit: &(dyn Fn(&str, Value) + Sync),
) -> Result<DeviceOutcome, AtlasError> {
    let cancel = Arc::new(Notify::new());
    cancels()
        .lock()?
        .insert(id.to_string(), Arc::clone(&cancel));
    let out = run_with(cfg, emit, &cancel, SLOW_DOWN_STEP).await;
    cancels().lock()?.remove(id);
    out
}

async fn run_with(
    cfg: &AuthConfig,
    emit: &(dyn Fn(&str, Value) + Sync),
    cancel: &Notify,
    slow_step: Duration,
) -> Result<DeviceOutcome, AtlasError> {
    let url = cfg.device_auth_url.as_deref().ok_or_else(|| {
        AtlasError::internal("This connector has no device authorization endpoint")
    })?;
    let client = reqwest::Client::new();
    let scope = cfg.scopes.join(" ");
    let code: CodeResponse = serde_json::from_value(
        post_form(
            &client,
            url,
            &[("client_id", &cfg.client_id), ("scope", &scope)],
        )
        .await?,
    )
    .map_err(|e| unexpected("device code", e))?;

    let mut interval = Duration::from_secs(code.interval.unwrap_or(DEFAULT_INTERVAL));
    let deadline = Instant::now() + Duration::from_secs(code.expires_in);
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64 + code.expires_in * 1000);
    emit(
        "connector://device-code",
        json!(DeviceCode {
            user_code: code.user_code,
            verification_uri: code.verification_uri,
            verification_uri_complete: code.verification_uri_complete,
            expires_in: code.expires_in,
            interval: interval.as_secs(),
        }),
    );
    emit(
        "connector://progress",
        json!({ "phase": "waiting", "expiresAt": expires_at }),
    );

    loop {
        tokio::select! {
            _ = cancel.notified() => return Ok(DeviceOutcome::Cancelled),
            _ = tokio::time::sleep(interval) => {}
        }
        if Instant::now() >= deadline {
            return Ok(DeviceOutcome::Expired);
        }
        let fields = [
            ("client_id", cfg.client_id.as_str()),
            ("device_code", code.device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ];
        let poll = post_form(&client, &cfg.token_url, &fields);
        let res = tokio::select! {
            _ = cancel.notified() => return Ok(DeviceOutcome::Cancelled),
            r = poll => r?,
        };
        let t: TokenResponse = serde_json::from_value(res).map_err(|e| unexpected("token", e))?;
        if let Some(access_token) = t.access_token {
            return Ok(DeviceOutcome::Success(Tokens {
                access: access_token,
                refresh: t.refresh_token,
                expires_in: t.expires_in,
                scope: t.scope,
            }));
        }
        match t.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += slow_step,
            Some("access_denied") => return Ok(DeviceOutcome::Denied),
            Some("expired_token") => return Ok(DeviceOutcome::Expired),
            other => {
                return Ok(DeviceOutcome::Failed {
                    message: t
                        .error_description
                        .or_else(|| other.map(str::to_string))
                        .unwrap_or_else(|| "Sign-in failed".to_string()),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn server(expires_in: u64) -> (MockServer, AuthConfig) {
        let s = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/code"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "device_code": "dc", "user_code": "ABCD-1234",
                "verification_uri": "https://example.test/device",
                "expires_in": expires_in, "interval": 0
            })))
            .mount(&s)
            .await;
        let cfg = AuthConfig {
            client_id: "cid".into(),
            scopes: vec!["repo".into()],
            auth_url: String::new(),
            token_url: format!("{}/token", s.uri()),
            redirect_ports: vec![],
            device_auth_url: Some(format!("{}/code", s.uri())),
        };
        (s, cfg)
    }

    fn err(code: &str) -> ResponseTemplate {
        ResponseTemplate::new(400).set_body_json(json!({ "error": code }))
    }

    fn ok() -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at" }))
    }

    async fn run_it(cfg: &AuthConfig, step: Duration) -> DeviceOutcome {
        let events = Mutex::new(Vec::<String>::new());
        let emit = |name: &str, _: Value| events.lock().unwrap().push(name.to_string());
        let out = run_with(cfg, &emit, &Notify::new(), step).await.unwrap();
        assert_eq!(
            *events.lock().unwrap(),
            ["connector://device-code", "connector://progress"]
        );
        out
    }

    #[tokio::test]
    async fn pending_then_success() {
        let (s, cfg) = server(60).await;
        Mock::given(path("/token"))
            .respond_with(err("authorization_pending"))
            .up_to_n_times(2)
            .mount(&s)
            .await;
        Mock::given(path("/token"))
            .respond_with(ok())
            .mount(&s)
            .await;
        assert_eq!(
            run_it(&cfg, SLOW_DOWN_STEP).await,
            DeviceOutcome::Success(Tokens {
                access: "at".into(),
                refresh: None,
                expires_in: None,
                scope: None
            })
        );
    }

    #[tokio::test]
    async fn slow_down_increases_interval() {
        let (s, cfg) = server(60).await;
        Mock::given(path("/token"))
            .respond_with(err("slow_down"))
            .up_to_n_times(1)
            .mount(&s)
            .await;
        Mock::given(path("/token"))
            .respond_with(ok())
            .mount(&s)
            .await;
        let t = Instant::now();
        run_it(&cfg, Duration::from_millis(200)).await;
        assert!(t.elapsed() >= Duration::from_millis(200));
    }

    #[tokio::test]
    async fn denied_and_expired_are_distinct() {
        for (code, want) in [
            ("access_denied", DeviceOutcome::Denied),
            ("expired_token", DeviceOutcome::Expired),
        ] {
            let (s, cfg) = server(60).await;
            Mock::given(path("/token"))
                .respond_with(err(code))
                .mount(&s)
                .await;
            assert_eq!(run_it(&cfg, SLOW_DOWN_STEP).await, want);
        }
    }

    #[tokio::test]
    async fn local_deadline_expires() {
        let (s, cfg) = server(0).await;
        Mock::given(path("/token"))
            .respond_with(err("authorization_pending"))
            .mount(&s)
            .await;
        assert_eq!(run_it(&cfg, SLOW_DOWN_STEP).await, DeviceOutcome::Expired);
    }

    #[tokio::test]
    async fn cancel_mid_poll() {
        let (s, cfg) = server(60).await;
        Mock::given(path("/token"))
            .respond_with(err("authorization_pending"))
            .mount(&s)
            .await;
        let cancel = Arc::new(Notify::new());
        let c2 = Arc::clone(&cancel);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            c2.notify_one();
        });
        let out = run_with(&cfg, &|_, _| {}, &cancel, SLOW_DOWN_STEP).await;
        assert_eq!(out.unwrap(), DeviceOutcome::Cancelled);
    }

    #[tokio::test]
    async fn network_failure_is_offline() {
        let (s, cfg) = server(60).await;
        drop(s);
        let out = run_with(&cfg, &|_, _| {}, &Notify::new(), SLOW_DOWN_STEP).await;
        assert!(matches!(out, Err(AtlasError::ConnectorOffline { .. })));
    }
}
