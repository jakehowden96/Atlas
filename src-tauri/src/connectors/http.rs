//! The one HTTP client providers use: bearer auth, one retry after a refresh
//! on 401, and errors mapped to `AtlasError`.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::HeaderMap;
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::{de::DeserializeOwned, Serialize};

use super::Connectors;
use crate::error::AtlasError;

const TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_RETRY_SECS: u64 = 60;

pub fn client() -> Client {
    Client::builder()
        .timeout(TIMEOUT)
        .user_agent(format!("Atlas/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Unix seconds at which a 429 lifts, from `Retry-After` (seconds) or a
/// rate-limit reset header (Unix seconds, or milliseconds as Linear sends).
fn retry_at(headers: &HeaderMap) -> u64 {
    let num = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
    };
    if let Some(secs) = num("retry-after") {
        return now_secs() + secs;
    }
    let reset = num("x-ratelimit-reset").or_else(|| num("x-ratelimit-requests-reset"));
    match reset {
        Some(ms) if ms > 1_000_000_000_000 => ms / 1000,
        Some(secs) => secs,
        None => now_secs() + DEFAULT_RETRY_SECS,
    }
}

/// Map a non-success status to the neutral error. Bodies are never echoed.
pub fn status_error(status: StatusCode, headers: &HeaderMap) -> AtlasError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return AtlasError::ConnectorRateLimited {
            message: "Rate limited, try again shortly".to_string(),
            retry_at: retry_at(headers),
        };
    }
    AtlasError::ConnectorRemote {
        message: format!("The service answered with status {}", status.as_u16()),
        status: status.as_u16(),
    }
}

pub fn offline() -> AtlasError {
    AtlasError::ConnectorOffline {
        message: "Could not reach the service".to_string(),
    }
}

pub struct AuthorizedClient<'a>(&'a Connectors);

impl Connectors {
    pub fn authorized(&self) -> AuthorizedClient<'_> {
        AuthorizedClient(self)
    }
}

impl AuthorizedClient<'_> {
    pub async fn get<T: DeserializeOwned>(&self, id: &str, url: &str) -> Result<T, AtlasError> {
        self.send(id, |c| c.get(url)).await
    }

    pub async fn post_json<B: Serialize + Sync, T: DeserializeOwned>(
        &self,
        id: &str,
        url: &str,
        body: &B,
    ) -> Result<T, AtlasError> {
        self.send(id, |c| c.post(url).json(body)).await
    }

    async fn send<T: DeserializeOwned>(
        &self,
        id: &str,
        build: impl Fn(&Client) -> RequestBuilder,
    ) -> Result<T, AtlasError> {
        let mut retried = false;
        loop {
            let token = self.0.access_token(id).await?;
            let resp = build(&self.0.http)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|_| offline())?;
            let status = resp.status();
            if status == StatusCode::UNAUTHORIZED && !retried {
                retried = true;
                self.0.access.forget(id)?;
                continue;
            }
            if !status.is_success() {
                return Err(status_error(status, resp.headers()));
            }
            return resp
                .json()
                .await
                .map_err(|_| AtlasError::parse("The service sent an unreadable response"));
        }
    }
}
