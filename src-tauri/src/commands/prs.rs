// Shapes only: the connectors build `Pr` values and ts-rs exports them to the UI.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The combined state of a pull request's checks.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CiState {
    Passed,
    Failed,
    Pending,
    None,
}

/// Where a pull request stands with its reviewers.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq, TS)]
#[ts(export, rename = "ReviewDecision")]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    ReviewRequired,
    None,
}

/// One open pull request. The connectors fill it in; the UI switches on the small scalars.
#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: PrAuthor,
    pub created_at: String,
    pub updated_at: String,
    pub is_draft: bool,
    /// The head branch lives in a fork. Its name is the fork's, so it says
    /// nothing about which commit a local branch of that name points at.
    pub is_cross_repository: bool,
    pub head_ref_name: String,
    pub ci_state: CiState,
    pub review_state: ReviewState,
    /// Logins of individually requested reviewers. Team requests carry no
    /// login and are dropped — "Needs my review" matches the viewer's login.
    pub review_request_logins: Vec<String>,
    pub comments_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct PrAuthor {
    #[serde(default)]
    pub login: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The UI switches on these exact words (`ciState === "failed"`).
    #[test]
    fn states_serialise_as_the_words_the_ui_switches_on() {
        assert_eq!(serde_json::json!(CiState::Passed), "passed");
        assert_eq!(serde_json::json!(CiState::None), "none");
        assert_eq!(
            serde_json::json!(ReviewState::ChangesRequested),
            "changes_requested"
        );
        assert_eq!(
            serde_json::json!(ReviewState::ReviewRequired),
            "review_required"
        );
    }
}
