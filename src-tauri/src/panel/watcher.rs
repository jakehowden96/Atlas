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

pub fn sessions_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".forge").join("sessions")
}

pub fn start_watcher(app_handle: AppHandle) -> Result<RecommendedWatcher, String> {
    let sessions = sessions_dir();
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
        let mut last_emit = Instant::now();
        let debounce = Duration::from_millis(200);

        for event in rx {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for path in &event.paths {
                        if path.file_name().map_or(false, |f| f == "panel.json") {
                            if last_emit.elapsed() < debounce {
                                continue;
                            }
                            last_emit = Instant::now();

                            match std::fs::read_to_string(path) {
                                Ok(contents) => {
                                    match serde_json::from_str::<PanelData>(&contents) {
                                        Ok(data) => {
                                            let _ =
                                                handle.emit("panel-update", data);
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
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(watcher)
}
