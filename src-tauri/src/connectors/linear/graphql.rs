//! One GraphQL POST with Linear's failure modes mapped to `AtlasError`.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::error::AtlasError;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn rate_limited(reset_ms: Option<u64>) -> AtlasError {
    AtlasError::ConnectorRateLimited {
        message: "Linear asked us to slow down".into(),
        retry_at: reset_ms.map_or(now() + 60, |ms| ms / 1000),
    }
}

fn reconnect() -> AtlasError {
    AtlasError::ConnectorReconnectNeeded {
        message: "Linear no longer accepts the saved sign-in".into(),
    }
}

/// Returns the `data` object. Linear reports most failures as GraphQL errors
/// (sometimes with HTTP 400), keyed by `extensions.code` / `extensions.type`.
pub async fn post(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    query: &str,
    variables: Value,
) -> Result<Value, AtlasError> {
    let resp = client
        .post(url)
        .bearer_auth(token)
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| AtlasError::ConnectorOffline {
            message: format!("Could not reach Linear: {e}"),
        })?;
    let status = resp.status();
    let reset_ms = resp
        .headers()
        .get("x-ratelimit-requests-reset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok());
    if status.as_u16() == 401 {
        return Err(reconnect());
    }
    if status.as_u16() == 429 {
        return Err(rate_limited(reset_ms));
    }
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if let Some(err) = body["errors"].get(0) {
        let ext = &err["extensions"];
        let kind = ext["code"]
            .as_str()
            .or_else(|| ext["type"].as_str())
            .unwrap_or("")
            .to_lowercase();
        let message = err["message"]
            .as_str()
            .unwrap_or("Linear error")
            .to_string();
        return Err(if kind.contains("ratelimit") {
            rate_limited(reset_ms)
        } else if kind.contains("authentication") || kind.contains("unauthenticated") {
            reconnect()
        } else if kind.contains("forbidden") {
            AtlasError::Forbidden { message }
        } else if kind.contains("not found") || kind.contains("not_found") {
            AtlasError::NotFound { message }
        } else {
            AtlasError::ConnectorRemote {
                message,
                status: status.as_u16(),
            }
        });
    }
    if !status.is_success() {
        return Err(AtlasError::ConnectorRemote {
            message: "Linear answered with an error".into(),
            status: status.as_u16(),
        });
    }
    Ok(body["data"].clone())
}
