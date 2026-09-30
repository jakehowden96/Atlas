use crate::error::AtlasError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelData {
    pub version: u32,
    pub timestamp: String,
    pub cwd: String,
    /// `null` when the tree is clean (or the directory holds no repo).
    pub diff: Option<DiffData>,
    /// Why there is nothing to show, when it is not simply a clean tree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<PanelIssue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelIssue {
    /// No `git` on PATH, so no directory can be diffed.
    GitNotFound,
}

/// What a size cap left out of a diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Truncation {
    /// Files present in the shown text (the last may be cut part-way).
    pub shown_files: u32,
    /// Files changed in all, as far as git could be asked.
    pub total_files: u32,
    pub shown_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Hash)]
pub struct DiffData {
    /// A single repo's diff. Empty when `projects` is set: the per-repo diffs
    /// live only there, so a multi-repo panel does not carry them twice.
    pub raw: String,
    /// Files changed, counting files a cap left out of `raw`/`projects`.
    pub files_changed: u32,
    /// Lines added and removed in the text that is present.
    pub lines_added: u32,
    pub lines_removed: u32,
    /// Identity of the diff content. Two payloads with the same fingerprint
    /// hold the same diff, so a consumer that already parsed one has nothing
    /// new to parse.
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<Truncation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<ProjectDiff>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_raw: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_truncated: Option<Truncation>,
}

impl DiffData {
    /// Stamp `fingerprint` from everything else in the payload.
    ///
    /// `DefaultHasher::new()` uses fixed keys, so the value is stable within
    /// and across runs of one build; it is only ever compared for equality.
    pub fn sealed(mut self) -> Self {
        use std::hash::{Hash, Hasher};
        self.fingerprint.clear();
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        self.hash(&mut hasher);
        self.fingerprint = format!("{:016x}", hasher.finish());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Hash)]
pub struct ProjectDiff {
    pub name: String,
    pub raw: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<Truncation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub has_unstaged: bool,
    pub has_staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelUpdateEvent {
    pub session_id: String,
    pub data: PanelData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeNotification {
    pub notification_type: String,
    pub title: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeNotificationEvent {
    pub session_id: String,
    pub notification: ClaudeNotification,
}

/// What Claude Code's `SessionStart` hook reports: the session UUID that is
/// now live, and why it fired. `source` is `"startup"` or `"resume"` — where
/// it always matches the id Atlas already asked for — or `"clear"` /
/// `"compact"`, the two cases where Claude Code mints a session UUID of its
/// own mid-tab that Atlas never chose and has to catch up with.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSessionStart {
    pub claude_session_id: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSessionStartEvent {
    /// Atlas's own tab id (`ATLAS_SESSION_ID`) — constant for the tab's whole
    /// life, unlike `claude_session_id`.
    pub session_id: String,
    pub session_start: ClaudeSessionStart,
}

pub fn sessions_dir() -> Result<PathBuf, AtlasError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AtlasError::internal("Could not determine home directory"))?;
    Ok(home.join(".atlas").join("sessions"))
}
