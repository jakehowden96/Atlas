//! Linear workflow state -> neutral ticket status, and id validation.
//!
//! Mapping (Linear `state.type`): backlog and triage -> backlog, unstarted ->
//! todo, started -> inProgress (inReview when the state name contains
//! "review"), completed and canceled -> done (the rail has no cancelled
//! state), anything else -> unknown.

use crate::connectors::provider::TicketStatusKind;
use crate::error::AtlasError;

pub fn status_kind(state_type: &str, name: &str) -> TicketStatusKind {
    match state_type {
        "backlog" | "triage" => TicketStatusKind::Backlog,
        "unstarted" => TicketStatusKind::Todo,
        "started" if name.to_lowercase().contains("review") => TicketStatusKind::InReview,
        "started" => TicketStatusKind::InProgress,
        "completed" | "canceled" => TicketStatusKind::Done,
        _ => TicketStatusKind::Unknown,
    }
}

/// `TEAMKEY-number`, upper-cased. Anything else is rejected before any request.
pub fn parse_ticket_id(id: &str) -> Result<String, AtlasError> {
    let id = id.trim();
    let ok = id.split_once('-').is_some_and(|(k, n)| {
        !k.is_empty()
            && k.bytes().all(|c| c.is_ascii_alphanumeric())
            && k.as_bytes()[0].is_ascii_alphabetic()
            && !n.is_empty()
            && n.bytes().all(|c| c.is_ascii_digit())
    });
    if ok {
        Ok(id.to_ascii_uppercase())
    } else {
        Err(AtlasError::InvalidInput {
            message: format!("\"{id}\" is not a ticket id like ENG-482"),
        })
    }
}
