use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelData {
    pub version: u32,
    pub timestamp: String,
    pub cwd: String,
    /// Whether the CWD is inside (or a parent of) a git repository.
    #[serde(default)]
    pub is_git: bool,
    pub diff: Option<DiffData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffData {
    pub raw: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<ProjectDiff>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_files_changed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_lines_added: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_lines_removed: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDiff {
    pub name: String,
    pub raw: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub has_unstaged: bool,
    pub has_staged: bool,
    pub has_unpushed: bool,
    pub commits_behind: u32,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub name: String,
    pub branch: String,
    pub commits_behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelUpdateEvent {
    pub session_id: String,
    pub data: PanelData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolNotification {
    pub notification_type: String,
    pub title: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolNotificationEvent {
    pub session_id: String,
    pub notification: ToolNotification,
}

pub fn sessions_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".atlas").join("sessions"))
}
