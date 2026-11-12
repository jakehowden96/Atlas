use serde_json::{json, Value};
use wiremock::matchers::{header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn issue(state_type: &str, name: &str) -> Value {
    json!({ "data": { "issue": {
        "identifier": "ENG-482", "title": "Fix retry", "url": "https://linear.app/x/issue/ENG-482",
        "assignee": { "displayName": "jake" }, "state": { "name": name, "type": state_type }
    } } })
}

async fn server(resp: ResponseTemplate) -> (MockServer, LinearProvider) {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .and(header("authorization", "Bearer tok"))
        .respond_with(resp)
        .mount(&s)
        .await;
    let p = LinearProvider::with_api_url(&s.uri());
    (s, p)
}

#[tokio::test]
async fn maps_every_status_type() {
    let cases = [
        ("backlog", "Backlog", TicketStatusKind::Backlog),
        ("triage", "Triage", TicketStatusKind::Backlog),
        ("unstarted", "Todo", TicketStatusKind::Todo),
        ("started", "In Progress", TicketStatusKind::InProgress),
        ("started", "In Review", TicketStatusKind::InReview),
        ("completed", "Done", TicketStatusKind::Done),
        ("canceled", "Canceled", TicketStatusKind::Done),
        ("weird", "Odd", TicketStatusKind::Unknown),
    ];
    for (ty, name, kind) in cases {
        let (_s, p) = server(ResponseTemplate::new(200).set_body_json(issue(ty, name))).await;
        let t = p.get_ticket("tok", "eng-482").await.unwrap();
        assert_eq!(t.status_kind, kind, "{ty}");
        assert_eq!(t.status, name);
        assert_eq!(t.id, "ENG-482");
        assert_eq!(t.assignee.as_deref(), Some("jake"));
    }
}

#[tokio::test]
async fn malformed_id_never_hits_the_network() {
    let (s, p) = server(ResponseTemplate::new(200)).await;
    for bad in ["", "482", "ENG-", "ENG-12x", "-5", "a b-1", "ENG-1; drop"] {
        assert!(matches!(
            p.get_ticket("tok", bad).await,
            Err(AtlasError::InvalidInput { .. })
        ));
    }
    assert!(s.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn null_issue_and_graphql_errors_map_to_typed_errors() {
    let (_s, p) =
        server(ResponseTemplate::new(200).set_body_json(json!({ "data": { "issue": null } })))
            .await;
    assert!(matches!(
        p.get_ticket("tok", "ENG-1").await,
        Err(AtlasError::NotFound { .. })
    ));

    let err = |code: &str| {
        ResponseTemplate::new(400).set_body_json(json!({
            "errors": [{ "message": "m", "extensions": { "code": code } }]
        }))
    };
    let (_s, p) = server(err("FORBIDDEN")).await;
    assert!(matches!(
        p.get_ticket("tok", "ENG-1").await,
        Err(AtlasError::Forbidden { .. })
    ));
    let (_s, p) = server(err("RATELIMITED")).await;
    assert!(matches!(
        p.get_ticket("tok", "ENG-1").await,
        Err(AtlasError::ConnectorRateLimited { .. })
    ));
    let (_s, p) = server(err("AUTHENTICATION_ERROR")).await;
    assert!(matches!(
        p.get_ticket("tok", "ENG-1").await,
        Err(AtlasError::ConnectorReconnectNeeded { .. })
    ));
}

#[tokio::test]
async fn http_401_needs_reconnect_and_429_is_rate_limited() {
    let (_s, p) = server(ResponseTemplate::new(401)).await;
    assert!(matches!(
        p.get_ticket("tok", "ENG-1").await,
        Err(AtlasError::ConnectorReconnectNeeded { .. })
    ));
    let (_s, p) = server(ResponseTemplate::new(429)).await;
    assert!(matches!(
        p.get_ticket("tok", "ENG-1").await,
        Err(AtlasError::ConnectorRateLimited { .. })
    ));
}

#[tokio::test]
async fn viewer_labels_the_account() {
    let (_s, p) = server(ResponseTemplate::new(200).set_body_json(
        json!({ "data": { "viewer": { "name": "Jake H", "displayName": "jake" } } }),
    ))
    .await;
    let v = p.viewer("tok").await.unwrap();
    assert_eq!(
        (v.login.as_str(), v.name.as_deref()),
        ("jake", Some("Jake H"))
    );
}

#[tokio::test]
async fn personal_api_keys_are_sent_without_bearer() {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .and(header("authorization", "lin_api_k"))
        .respond_with(ResponseTemplate::new(200).set_body_json(issue("started", "In Progress")))
        .expect(1)
        .mount(&s)
        .await;
    let p = LinearProvider::with_api_url(&s.uri());
    assert_eq!(
        p.get_ticket("lin_api_k", "ENG-482").await.unwrap().id,
        "ENG-482"
    );
}
