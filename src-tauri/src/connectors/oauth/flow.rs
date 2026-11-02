//! Authorization Code + PKCE through the system browser.

use serde::Deserialize;
use tokio::sync::oneshot;

use super::loopback::{self, TIMEOUT};
use super::pkce::Pkce;
use crate::connectors::provider::AuthConfig;
use crate::error::AtlasError;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Tokens {
    #[serde(rename = "access_token")]
    pub access: String,
    #[serde(rename = "refresh_token")]
    pub refresh: Option<String>,
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
}

/// `progress` gets "opened", "waiting" then "exchanging"; `open` launches the
/// authorization URL in the browser.
pub async fn run_browser_flow(
    cfg: &AuthConfig,
    cancel: oneshot::Receiver<()>,
    progress: impl Fn(&str),
    open: impl FnOnce(&str) -> Result<(), AtlasError>,
) -> Result<Tokens, AtlasError> {
    let listener = loopback::bind(&cfg.redirect_ports).await?;
    let redirect = format!("http://127.0.0.1:{}/callback", listener.port);
    let pkce = Pkce::generate();

    let mut url = url::Url::parse(&cfg.auth_url)
        .map_err(|e| AtlasError::internal(format!("Bad authorization URL: {e}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &cfg.client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("scope", &cfg.scopes.join(" "))
        .append_pair("state", &pkce.state)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256");
    open(url.as_str())?;
    progress("opened");
    progress("waiting");

    let code = listener.wait(&pkce.state, TIMEOUT, cancel).await?;
    progress("exchanging");
    exchange(cfg, &code, &redirect, &pkce.verifier).await
}

/// Public client: no secret, the verifier proves possession.
async fn exchange(
    cfg: &AuthConfig,
    code: &str,
    redirect: &str,
    verifier: &str,
) -> Result<Tokens, AtlasError> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "authorization_code")
        .append_pair("code", code)
        .append_pair("redirect_uri", redirect)
        .append_pair("client_id", &cfg.client_id)
        .append_pair("code_verifier", verifier)
        .finish();
    let response = reqwest::Client::new()
        .post(&cfg.token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| AtlasError::ConnectorOffline {
            message: format!("Could not reach the service: {e}"),
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(AtlasError::ConnectorRemote {
            message: format!("The service refused the sign-in ({status})"),
            status: status.as_u16(),
        });
    }
    response
        .json()
        .await
        .map_err(|e| AtlasError::parse(format!("Unexpected token response: {e}")))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    /// Answers one token request with `status`/`body`; returns its URL and the
    /// request text it saw.
    async fn mock_token(status: &str, body: &'static str) -> (String, Arc<Mutex<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", l.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(String::new()));
        let (seen2, status) = (seen.clone(), status.to_string());
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = s.read(&mut buf).await.unwrap();
            *seen2.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).into_owned();
            let r = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(r.as_bytes()).await.unwrap();
        });
        (url, seen)
    }

    async fn cfg(token_url: String) -> AuthConfig {
        let spare = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = spare.local_addr().unwrap().port();
        drop(spare);
        AuthConfig {
            client_id: "client-1".into(),
            scopes: vec!["read".into()],
            auth_url: "https://example.test/authorize".into(),
            token_url,
            redirect_ports: vec![port],
            device_auth_url: None,
        }
    }

    /// A "browser" that calls back with `state_override` or the real state.
    fn browser(
        extra: &'static str,
        state_override: Option<&'static str>,
    ) -> impl FnOnce(&str) -> Result<(), AtlasError> {
        move |auth: &str| {
            let u = url::Url::parse(auth).unwrap();
            let q = |k: &str| {
                u.query_pairs()
                    .find(|(n, _)| n == k)
                    .unwrap()
                    .1
                    .into_owned()
            };
            assert_eq!(q("code_challenge_method"), "S256");
            let port = url::Url::parse(&q("redirect_uri")).unwrap().port().unwrap();
            let state = state_override.map_or_else(|| q("state"), str::to_string);
            let target = format!("/callback?{extra}&state={state}");
            tokio::spawn(async move {
                let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
                    .await
                    .unwrap();
                s.write_all(format!("GET {target} HTTP/1.1\r\n\r\n").as_bytes())
                    .await
                    .unwrap();
                let mut out = String::new();
                let _ = s.read_to_string(&mut out).await;
            });
            Ok(())
        }
    }

    #[tokio::test]
    async fn full_flow_sends_verifier_and_no_secret() {
        let (url, seen) = mock_token(
            "200 OK",
            r#"{"access_token":"a","refresh_token":"r","expires_in":3600,"scope":"read"}"#,
        )
        .await;
        let phases = Mutex::new(Vec::new());
        let (_tx, rx) = oneshot::channel();
        let t = run_browser_flow(
            &cfg(url).await,
            rx,
            |p| phases.lock().unwrap().push(p.to_string()),
            browser("code=the-code", None),
        )
        .await
        .unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_deref()), ("a", Some("r")));
        assert_eq!(*phases.lock().unwrap(), ["opened", "waiting", "exchanging"]);
        let req = seen.lock().unwrap().clone();
        assert!(req.contains("code=the-code") && req.contains("code_verifier="));
        assert!(!req.contains("client_secret"));
    }

    #[tokio::test]
    async fn wrong_state_never_reaches_the_token_endpoint() {
        let (url, seen) = mock_token("200 OK", "{}").await;
        let (_tx, rx) = oneshot::channel();
        let r = run_browser_flow(
            &cfg(url).await,
            rx,
            |_| {},
            browser("code=x", Some("forged")),
        )
        .await;
        assert!(r.is_err());
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn token_endpoint_error_is_remote() {
        let (url, _) = mock_token("400 Bad Request", r#"{"error":"invalid_grant"}"#).await;
        let (_tx, rx) = oneshot::channel();
        let r = run_browser_flow(&cfg(url).await, rx, |_| {}, browser("code=x", None)).await;
        assert!(matches!(
            r,
            Err(AtlasError::ConnectorRemote { status: 400, .. })
        ));
    }
}
