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
use std::collections::{HashMap, HashSet};
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
    /// Sessions Atlas has spawned whose transcript does not exist yet.
    ///
    /// Claude Code writes the file well after the spawn — cold start plus the
    /// first turn — so waiting for it inline means picking a timeout, and any
    /// timeout is either too short (the tail never starts) or a stall. Instead
    /// the uuid is registered here and the watcher, which already sees every
    /// write under `~/.claude/projects`, attaches the tail the moment the file
    /// turns up.
    pending: Arc<Mutex<HashSet<String>>>,
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

    /// Register a session to be tailed as soon as its transcript appears.
    pub fn expect(&self, session_uuid: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        pending.insert(session_uuid.to_string());
        Ok(())
    }

    pub fn stop(&self, session_uuid: &str) -> Result<(), String> {
        let mut tails = self.tails.lock().map_err(|e| e.to_string())?;
        tails.remove(session_uuid);
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(session_uuid);
        }
        Ok(())
    }

    /// True while `session_uuid` is awaited but not yet tailed.
    #[cfg(test)]
    pub fn is_pending(&self, session_uuid: &str) -> bool {
        self.pending
            .lock()
            .map(|p| p.contains(session_uuid))
            .unwrap_or(false)
    }

    /// If `path` is the transcript of a pending session, begin tailing it.
    /// Returns the uuid when a tail was newly attached.
    fn adopt_pending(&self, path: &Path) -> Option<String> {
        if path.extension()? != "jsonl" {
            return None;
        }
        let uuid = path.file_stem()?.to_str()?.to_string();
        {
            let pending = self.pending.lock().ok()?;
            if !pending.contains(&uuid) {
                return None;
            }
        }
        self.start(&uuid, path.to_path_buf()).ok()?;
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&uuid);
        }
        Some(uuid)
    }

    /// The live state of a tracked session. Test-only: the UI never polls it,
    /// updates arrive as `session-update` events.
    #[cfg(test)]
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
                // A pending session's file may be appearing for the first time.
                let uuid = match manager.uuid_for_path(path) {
                    Some(uuid) => uuid,
                    None => match manager.adopt_pending(path) {
                        Some(uuid) => uuid,
                        None => continue,
                    },
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

    /// The transcript does not exist when `start_session_tail` runs: Claude has
    /// not finished starting. The session is registered instead, and the
    /// watcher adopts it when the file lands.
    #[test]
    fn a_pending_session_is_adopted_when_its_transcript_appears() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LiveSessionManager::new();

        manager.expect(UUID).unwrap();
        assert!(manager.is_pending(UUID));
        assert!(manager.get(UUID).unwrap().is_none());

        // Claude finally writes the transcript.
        let path = transcript(dir.path(), USER_LINE);
        let adopted = manager.adopt_pending(&path).expect("adopted");

        assert_eq!(adopted, UUID);
        assert!(!manager.is_pending(UUID), "no longer pending once tailed");
        assert_eq!(manager.get(UUID).unwrap().expect("tracked").lines.len(), 1);
    }

    #[test]
    fn adopt_ignores_transcripts_of_sessions_we_never_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        assert!(manager.adopt_pending(&path).is_none());
        assert!(manager.get(UUID).unwrap().is_none());
    }

    #[test]
    fn stop_clears_a_session_that_was_still_pending() {
        let manager = LiveSessionManager::new();
        manager.expect(UUID).unwrap();
        manager.stop(UUID).unwrap();
        assert!(!manager.is_pending(UUID), "a closed session must not be adopted later");
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
