use super::types::*;
use crate::commands::validate::validate_session_id;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Quiet time after the last `panel.json` event before it is announced.
const DEBOUNCE: Duration = Duration::from_millis(200);

/// Extract the session ID from a watched file path: .../sessions/<session_id>/<file>.
/// `None` for anything that is not directly inside a valid session directory —
/// an event keyed under `""` or a stray name would make the frontend file state
/// under a session that does not exist.
fn session_id_from_path(path: &Path) -> Option<String> {
    let dir = path.parent()?;
    let id = dir.file_name()?.to_str()?;
    if dir.parent()?.file_name()? != "sessions" || validate_session_id(id).is_err() {
        log::warn!(
            "Ignoring watched path outside a session directory: {}",
            path.display()
        );
        return None;
    }
    Some(id.to_string())
}

/// Read a one-shot signal file (`notification.json`, `session-id.json`) and
/// delete it, but only once it parsed. The writer may not have finished when
/// the create event fires; deleting first would throw the real payload away
/// with the unlinked file. An unparseable file is left for the next event.
fn take_signal<T: DeserializeOwned>(path: &Path, what: &str) -> Option<T> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(e) => {
            log::warn!("Failed to read {what}: {e}");
            return None;
        }
    };
    match serde_json::from_str::<T>(&contents) {
        Ok(value) => {
            let _ = std::fs::remove_file(path);
            Some(value)
        }
        Err(e) => {
            log::warn!("Failed to parse {what} (leaving it for the next write): {e}");
            None
        }
    }
}

fn emit_panel(handle: &AppHandle, session_id: String, path: &Path) {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(e) => {
            log::warn!("Failed to read panel.json: {}", e);
            return;
        }
    };
    match serde_json::from_str::<PanelData>(&contents) {
        Ok(data) => {
            if let Err(e) = handle.emit("panel-update", PanelUpdateEvent { session_id, data }) {
                log::debug!("panel-update emit failed: {e}");
            }
        }
        Err(e) => log::warn!("Failed to parse panel.json: {}", e),
    }
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
        // Session -> (panel.json path, when it was last touched). Trailing
        // edge: a refresh is announced once writes have been quiet for
        // DEBOUNCE, so a burst collapses into one event that carries the final
        // contents instead of dropping everything after the first.
        let mut pending: HashMap<String, (std::path::PathBuf, Instant)> = HashMap::new();

        loop {
            match rx.recv_timeout(DEBOUNCE / 2) {
                Ok(event) => {
                    let relevant =
                        matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_));
                    for path in event.paths.iter().filter(|_| relevant) {
                        let Some(name) = path.file_name() else {
                            continue;
                        };
                        if name != "panel.json"
                            && name != "notification.json"
                            && name != "session-id.json"
                        {
                            continue;
                        }
                        let Some(session_id) = session_id_from_path(path) else {
                            continue;
                        };
                        if name == "panel.json" {
                            pending.insert(session_id, (path.clone(), Instant::now()));
                        } else if name == "notification.json" {
                            if let Some(notification) =
                                take_signal::<ClaudeNotification>(path, "notification.json")
                            {
                                if let Err(e) = handle.emit(
                                    "claude-notification",
                                    ClaudeNotificationEvent {
                                        session_id,
                                        notification,
                                    },
                                ) {
                                    log::debug!("claude-notification emit failed: {e}");
                                }
                            }
                        } else if let Some(session_start) =
                            take_signal::<ClaudeSessionStart>(path, "session-id.json")
                        {
                            if let Err(e) = handle.emit(
                                "claude-session-start",
                                ClaudeSessionStartEvent {
                                    session_id,
                                    session_start,
                                },
                            ) {
                                log::debug!("claude-session-start emit failed: {e}");
                            }
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            let now = Instant::now();
            pending.retain(|session_id, (path, last_seen)| {
                if now.duration_since(*last_seen) < DEBOUNCE {
                    return true;
                }
                emit_panel(&handle, session_id.clone(), path);
                false
            });
        }
    });

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_comes_from_the_directory_under_sessions() {
        let path = Path::new("/home/me/.atlas/sessions/abc-123/panel.json");
        assert_eq!(session_id_from_path(path).as_deref(), Some("abc-123"));
    }

    #[test]
    fn a_file_outside_a_session_directory_has_no_session() {
        // Directly under `sessions/`: the "id" would be `sessions` itself.
        assert_eq!(
            session_id_from_path(Path::new("/home/me/.atlas/sessions/panel.json")),
            None
        );
        assert_eq!(
            session_id_from_path(Path::new("/home/me/.atlas/sessions/not valid/panel.json")),
            None
        );
        assert_eq!(session_id_from_path(Path::new("panel.json")), None);
    }

    #[test]
    fn a_signal_is_kept_until_it_parses_then_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session-id.json");

        // The create event can fire before the writer's bytes land.
        std::fs::write(&path, "").unwrap();
        assert!(take_signal::<ClaudeSessionStart>(&path, "session-id.json").is_none());
        assert!(path.exists(), "a partial write must not be thrown away");

        std::fs::write(&path, r#"{"claude_session_id":"u","source":"clear"}"#).unwrap();
        let signal = take_signal::<ClaudeSessionStart>(&path, "session-id.json").unwrap();
        assert_eq!(signal.source, "clear");
        assert!(!path.exists());
    }
}
