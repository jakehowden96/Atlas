use super::types::*;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Extract the session ID from a watched file path: .../sessions/<session_id>/<file>
fn session_id_from_path(path: &std::path::Path) -> String {
    let session_id = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    if session_id.is_empty() {
        log::warn!(
            "Could not extract session id from watched path: {}",
            path.display()
        );
    }
    session_id
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
                            let session_id = session_id_from_path(path);

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
                            let session_id = session_id_from_path(path);

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
