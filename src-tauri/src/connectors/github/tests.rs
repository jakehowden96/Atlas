use wiremock::matchers::{header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::connectors::provider::{CheckStatus as C, PullRequestState, ReviewState};

const LIST_OK: &str = include_str!("../../../tests/fixtures/github/list_ok.json");
const LIST_PARTIAL: &str = include_str!("../../../tests/fixtures/github/list_partial.json");
const VIEWER: &str = include_str!("../../../tests/fixtures/github/viewer.json");

fn repo(slug: &str) -> RepoRef {
    RepoRef { slug: slug.into() }
}

async fn serve(resp: ResponseTemplate) -> (MockServer, GithubProvider) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(header("authorization", "Bearer tok"))
        .respond_with(resp)
        .mount(&server)
        .await;
    let provider = GithubProvider::with_endpoint(&server.uri());
    (server, provider)
}

fn json(body: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(body.as_bytes().to_vec(), "application/json")
}

#[tokio::test]
async fn viewer_reads_login_and_name() {
    let (_s, p) = serve(json(VIEWER)).await;
    let v = p.viewer("tok").await.unwrap();
    assert_eq!(v.login, "octo");
    assert_eq!(v.name, None);
}

#[tokio::test]
async fn maps_prs_checks_and_review_states() {
    let (_s, p) = serve(json(LIST_OK)).await;
    let out = p
        .list_pull_requests_by_repo("tok", &[repo("acme/app")])
        .await;
    let prs = out[0].result.as_ref().unwrap();
    assert_eq!(prs.len(), 4);

    let a = &prs[0];
    assert_eq!(a.state, PullRequestState::Open);
    assert_eq!(a.review, ReviewState::Approved);
    assert_eq!(a.ci, Some(C::Fail));
    assert_eq!(a.author, "octo");
    let got: Vec<_> = a
        .checks
        .iter()
        .map(|c| (c.name.as_str(), c.status, c.details_url.as_deref()))
        .collect();
    assert_eq!(
        got,
        vec![
            (
                "build",
                C::Pass,
                Some("https://github.com/acme/app/actions/runs/1/job/1")
            ),
            (
                "lint",
                C::Pass,
                Some("https://github.com/acme/app/actions/runs/1/job/2")
            ),
            (
                "test",
                C::Fail,
                Some("https://github.com/acme/app/actions/runs/1/job/3")
            ),
            ("deploy", C::Pending, None),
            (
                "ci/legacy",
                C::Pending,
                Some("https://ci.example.test/legacy/9")
            ),
        ]
    );

    // Draft fork: no checks, two unresolved threads.
    let b = &prs[1];
    assert_eq!(b.state, PullRequestState::Draft);
    assert!(b.is_cross_repository);
    assert_eq!(b.ci, None);
    assert!(b.checks.is_empty());
    assert_eq!(b.review, ReviewState::Comments { count: 2 });

    // Changes requested beats comments; unknown/queued are pending; truncated.
    let c = &prs[2];
    assert_eq!(c.review, ReviewState::Changes);
    assert_eq!(c.author, "");
    assert_eq!(
        c.checks.iter().map(|k| k.status).collect::<Vec<_>>(),
        vec![C::Pending, C::Fail, C::Fail, C::Fail, C::Pending]
    );

    let d = &prs[3];
    assert_eq!(d.review, ReviewState::Awaiting);
    assert_eq!(d.ci, Some(C::Pass));
    assert_eq!(d.checks[1].status, C::Fail);
}

#[tokio::test]
async fn one_failing_repo_does_not_fail_the_rest() {
    let (_s, p) = serve(json(LIST_PARTIAL)).await;
    let repos = [
        repo("acme/ok"),
        repo("acme/gone"),
        repo("acme/sso"),
        repo("not a slug"),
    ];
    let out = p.list_pull_requests_by_repo("tok", &repos).await;
    let by = |slug: &str| out.iter().find(|r| r.repo.slug == slug).unwrap();
    assert!(by("acme/ok").result.as_ref().unwrap().is_empty());
    assert!(matches!(
        by("acme/gone").result,
        Err(AtlasError::NotFound { .. })
    ));
    assert!(matches!(
        by("acme/sso").result,
        Err(AtlasError::Forbidden { .. })
    ));
    assert!(matches!(
        by("not a slug").result,
        Err(AtlasError::InvalidInput { .. })
    ));
}

#[tokio::test]
async fn trait_list_succeeds_unless_every_repo_fails() {
    let (_s, p) = serve(json(LIST_PARTIAL)).await;
    let ok = p
        .list_pull_requests("tok", &[repo("acme/ok"), repo("acme/gone")])
        .await;
    assert!(ok.unwrap().is_empty());
    let (_s, p) = serve(json(LIST_PARTIAL)).await;
    assert!(p.list_pull_requests("tok", &[repo("bad")]).await.is_err());
}

#[tokio::test]
async fn http_failures_map_to_connector_errors() {
    let cases = [
        (ResponseTemplate::new(401), "ConnectorReconnectNeeded"),
        (
            ResponseTemplate::new(403).insert_header("x-ratelimit-remaining", "0"),
            "ConnectorRateLimited",
        ),
        (ResponseTemplate::new(403), "Forbidden"),
        (ResponseTemplate::new(502), "ConnectorRemote"),
    ];
    for (resp, want) in cases {
        let (_s, p) = serve(resp).await;
        let err = p.viewer("tok").await.unwrap_err();
        assert!(format!("{err:?}").starts_with(want), "{want}: {err:?}");
    }
}

#[tokio::test]
async fn graphql_rate_limit_error_is_rate_limited() {
    let body =
        r#"{"data":null,"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}"#;
    let (_s, p) = serve(json(body)).await;
    assert!(matches!(
        p.viewer("tok").await,
        Err(AtlasError::ConnectorRateLimited { .. })
    ));
}

#[test]
fn provider_is_github_device_code_pull_requests() {
    let info = GithubProvider::default().info();
    assert_eq!(info.id, "github");
    assert_eq!(info.flow, AuthFlow::DeviceCode);
    assert_eq!(info.kind, ConnectorKind::PullRequests);
    assert_eq!(info.methods, [AuthMethod::OAuth, AuthMethod::Cli]);
}
