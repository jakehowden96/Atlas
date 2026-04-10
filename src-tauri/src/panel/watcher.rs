use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelData {
    pub version: u32,
    pub timestamp: String,
    pub cwd: String,
    /// Whether the CWD is inside (or a parent of) a git repository.
    #[serde(default)]
    pub is_git: bool,
    pub diff: Option<DiffData>,
    pub summary: Option<SummaryData>,
    pub flow: Option<FlowData>,
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
pub struct SummaryData {
    pub summary: String,
    pub fix: String,
    pub why: String,
    pub confidence: f64,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub severity: String,
    pub file: String,
    pub line: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowData {
    pub edges: Vec<FlowEdge>,
    pub mermaid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
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
pub struct AnalysisStatusEvent {
    pub session_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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

pub fn sessions_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".atlas").join("sessions"))
}

pub fn start_watcher(app_handle: AppHandle) -> Result<RecommendedWatcher, String> {
    let sessions = sessions_dir()?;
    std::fs::create_dir_all(&sessions).map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(500)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&sessions, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Process events in a background thread
    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let mut last_emit_per_session: std::collections::HashMap<String, Instant> =
            std::collections::HashMap::new();
        let debounce = Duration::from_millis(200);

        for event in rx {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for path in &event.paths {
                        if path.file_name().map_or(false, |f| f == "panel.json") {
                            // Extract session ID from path: .../sessions/<session_id>/panel.json
                            let session_id = path
                                .parent()
                                .and_then(|p| p.file_name())
                                .map(|f| f.to_string_lossy().to_string())
                                .unwrap_or_default();

                            let last_emit = last_emit_per_session
                                .entry(session_id.clone())
                                .or_insert_with(|| Instant::now() - debounce);

                            if last_emit.elapsed() < debounce {
                                continue;
                            }
                            *last_emit = Instant::now();

                            match std::fs::read_to_string(path) {
                                Ok(contents) => {
                                    match serde_json::from_str::<PanelData>(&contents) {
                                        Ok(data) => {
                                            let _ =
                                                handle.emit("panel-update", PanelUpdateEvent {
                                                    session_id: session_id.clone(),
                                                    data,
                                                });
                                        }
                                        Err(e) => {
                                            log::warn!(
                                                "Failed to parse panel.json: {}",
                                                e
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Failed to read panel.json: {}", e);
                                }
                            }
                        } else if path.file_name().map_or(false, |f| f == "notification.json") {
                            let session_id = path
                                .parent()
                                .and_then(|p| p.file_name())
                                .map(|f| f.to_string_lossy().to_string())
                                .unwrap_or_default();

                            match std::fs::read_to_string(path) {
                                Ok(contents) => {
                                    // Delete the file immediately — it's a one-shot signal
                                    let _ = std::fs::remove_file(path);
                                    match serde_json::from_str::<ClaudeNotification>(&contents) {
                                        Ok(notification) => {
                                            let _ = handle.emit(
                                                "claude-notification",
                                                ClaudeNotificationEvent {
                                                    session_id,
                                                    notification,
                                                },
                                            );
                                        }
                                        Err(e) => {
                                            log::warn!(
                                                "Failed to parse notification.json: {}",
                                                e
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Failed to read notification.json: {}", e);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(watcher)
}
