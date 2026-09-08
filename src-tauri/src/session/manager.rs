//! Tracks the transcripts of the sessions Atlas is currently running and emits
//! `session-update` as they grow.
//!
//! A `stats-update` watcher already sits on `~/.claude/projects` (see
//! `commands::stats::start_stats_watcher`), but it debounces a full recompute
//! over every historical transcript at 1s. The live path must not wait on that,
//! so it keeps its own watcher on the same directory with a 250ms per-session
//! debounce and an incremental read.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use super::live::{LiveSession, SessionTail};
use crate::commands::stats::claude_projects_dir;

/// Per-session gap between emits. Short enough to feel live, long enough that a
/// burst of appends within one Claude turn collapses into one update.
const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
pub struct SessionUpdateEvent {
    pub session_uuid: String,
    pub session: LiveSession,
}

#[derive(Clone, Default)]
pub struct LiveSessionManager {
    tails: Arc<Mutex<HashMap<String, SessionTail>>>,
}

impl LiveSessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Begin tailing `path` for `session_uuid`, returning the state read so far.
    /// Starting an already-tracked session just returns its current state.
    pub fn start(&self, session_uuid: &str, path: PathBuf) -> Result<LiveSession, String> {
        let mut tails = self.tails.lock().map_err(|e| e.to_string())?;
        let tail = tails
            .entry(session_uuid.to_string())
            .or_insert_with(|| SessionTail::new(session_uuid.to_string(), path));
        tail.poll();
        Ok(tail.session().clone())
    }

    pub fn stop(&self, session_uuid: &str) -> Result<(), String> {
        let mut tails = self.tails.lock().map_err(|e| e.to_string())?;
        tails.remove(session_uuid);
        Ok(())
    }

    pub fn get(&self, session_uuid: &str) -> Result<Option<LiveSession>, String> {
        let tails = self.tails.lock().map_err(|e| e.to_string())?;
        Ok(tails.get(session_uuid).map(|t| t.session().clone()))
    }

    /// The session whose transcript is `path`, if it is one we track.
    fn uuid_for_path(&self, path: &Path) -> Option<String> {
        let tails = self.tails.lock().ok()?;
        tails
            .iter()
            .find(|(_, tail)| tail.path() == path)
            .map(|(uuid, _)| uuid.clone())
    }

    /// Fold in whatever has been appended. `None` when nothing changed.
    fn poll(&self, session_uuid: &str) -> Option<LiveSession> {
        let mut tails = self.tails.lock().ok()?;
        let tail = tails.get_mut(session_uuid)?;
        tail.poll().then(|| tail.session().clone())
    }
}

/// Holds the watcher alive for the life of the app. `Manager::manage` is keyed
/// by type and the panel and stats watchers are both bare `RecommendedWatcher`,
/// so ours needs a type of its own or it would be dropped on registration.
pub struct LiveWatcher(#[allow(dead_code)] RecommendedWatcher);

pub fn start_live_watcher(
    app_handle: AppHandle,
    manager: LiveSessionManager,
) -> Result<LiveWatcher, String> {
    let projects_dir = claude_projects_dir()?;
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(250)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&projects_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let mut last_emit: HashMap<String, Instant> = HashMap::new();

        for event in rx {
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                continue;
            }
            for path in &event.paths {
                let Some(uuid) = manager.uuid_for_path(path) else {
                    continue;
                };
                let slot = last_emit
                    .entry(uuid.clone())
                    .or_insert_with(|| Instant::now() - DEBOUNCE);
                if slot.elapsed() < DEBOUNCE {
                    continue;
                }
                *slot = Instant::now();

                if let Some(session) = manager.poll(&uuid) {
                    let _ = app_handle.emit(
                        "session-update",
                        SessionUpdateEvent { session_uuid: uuid, session },
                    );
                }
            }
        }
    });

    Ok(LiveWatcher(watcher))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const UUID: &str = "11111111-2222-4333-8444-555555555555";

    fn transcript(dir: &Path, line: &str) -> PathBuf {
        let path = dir.join(format!("{}.jsonl", UUID));
        let mut file = std::fs::File::create(&path).unwrap();
        writeln!(file, "{}", line).unwrap();
        path
    }

    const USER_LINE: &str =
        r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z"}"#;

    #[test]
    fn start_reads_the_transcript_and_get_returns_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        let session = manager.start(UUID, path).unwrap();
        assert_eq!(session.session_uuid, UUID);
        assert_eq!(session.lines.len(), 1);

        let fetched = manager.get(UUID).unwrap().expect("tracked");
        assert_eq!(fetched.lines.len(), 1);
    }

    #[test]
    fn get_is_none_for_an_untracked_session() {
        let manager = LiveSessionManager::new();
        assert!(manager.get(UUID).unwrap().is_none());
    }

    #[test]
    fn stop_drops_the_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        manager.start(UUID, path).unwrap();
        manager.stop(UUID).unwrap();
        assert!(manager.get(UUID).unwrap().is_none());
    }

    #[test]
    fn poll_only_reports_a_change_when_the_file_grew() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();
        manager.start(UUID, path.clone()).unwrap();

        assert!(manager.poll(UUID).is_none(), "nothing appended yet");

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{}", USER_LINE).unwrap();
        drop(file);

        let session = manager.poll(UUID).expect("the append is picked up");
        assert_eq!(session.lines.len(), 2);
    }

    #[test]
    fn uuid_for_path_matches_only_tracked_transcripts() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();
        manager.start(UUID, path.clone()).unwrap();

        assert_eq!(manager.uuid_for_path(&path).as_deref(), Some(UUID));
        assert_eq!(manager.uuid_for_path(&dir.path().join("other.jsonl")), None);
    }

    #[test]
    fn starting_twice_keeps_the_existing_offset() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        manager.start(UUID, path.clone()).unwrap();
        let again = manager.start(UUID, path).unwrap();
        assert_eq!(again.lines.len(), 1, "the file is not re-read from the start");
    }
}
