//! GraphQL nodes into the neutral pull request types.

use super::graphql::{Context, PrNode};
use crate::connectors::provider::{Check, CheckStatus, PullRequest, PullRequestState, ReviewState};

fn check_run_status(status: &str, conclusion: Option<&str>) -> CheckStatus {
    if status != "COMPLETED" {
        return CheckStatus::Pending;
    }
    match conclusion {
        Some("SUCCESS" | "NEUTRAL" | "SKIPPED") => CheckStatus::Pass,
        Some("FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE") => {
            CheckStatus::Fail
        }
        _ => CheckStatus::Pending,
    }
}

fn state_status(state: &str) -> CheckStatus {
    match state {
        "SUCCESS" => CheckStatus::Pass,
        "FAILURE" | "ERROR" => CheckStatus::Fail,
        _ => CheckStatus::Pending,
    }
}

fn map_check(c: &Context) -> Option<Check> {
    if let Some(name) = &c.name {
        let status = check_run_status(c.status.as_deref().unwrap_or(""), c.conclusion.as_deref());
        return Some(Check {
            name: name.clone(),
            status,
            details_url: c.details_url.clone(),
        });
    }
    let name = c.context.clone()?;
    Some(Check {
        name,
        status: state_status(c.state.as_deref().unwrap_or("")),
        details_url: c.target_url.clone(),
    })
}

fn review(node: &PrNode) -> ReviewState {
    let unresolved = node.review_threads.as_ref().map_or(0, |t| {
        t.nodes.iter().filter(|t| !t.is_resolved).count() as u32
    });
    match node.review_decision.as_deref() {
        Some("CHANGES_REQUESTED") => ReviewState::Changes,
        _ if unresolved > 0 => ReviewState::Comments { count: unresolved },
        Some("APPROVED") => ReviewState::Approved,
        _ => ReviewState::Awaiting,
    }
}

pub fn map_pr(node: PrNode) -> PullRequest {
    let rollup = node
        .commits
        .as_ref()
        .and_then(|c| c.nodes.first())
        .and_then(|c| c.commit.status_check_rollup.as_ref());
    let checks: Vec<Check> = rollup
        .map(|r| r.contexts.nodes.iter().filter_map(map_check).collect())
        .unwrap_or_default();
    // The rollup state covers checks beyond the first 100, so prefer it.
    let ci = rollup
        .filter(|_| !checks.is_empty())
        .map(|r| state_status(&r.state));
    let state = match (node.state.as_str(), node.is_draft) {
        ("MERGED", _) => PullRequestState::Merged,
        (_, true) => PullRequestState::Draft,
        _ => PullRequestState::Open,
    };
    let review = review(&node);
    let review_request_logins = node
        .review_requests
        .map(|r| {
            r.nodes
                .into_iter()
                .filter_map(|n| n.requested_reviewer.map(|u| u.login))
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default();
    PullRequest {
        number: node.number,
        title: node.title,
        url: node.url,
        state,
        head_ref_name: node.head_ref_name,
        author: node.author.map(|a| a.login).unwrap_or_default(),
        is_cross_repository: node.is_cross_repository,
        ci,
        checks,
        review,
        created_at: node.created_at,
        updated_at: node.updated_at,
        review_request_logins,
        comments_count: node.comments.map_or(0, |c| c.total_count),
    }
}
