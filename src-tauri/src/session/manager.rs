//! Tracks the transcripts of the sessions Atlas is currently running and emits
//! `session-update` as they grow.
//!
//! A `stats-update` watcher already sits on `~/.claude/projects` (see
//! `commands::stats::start_stats_watcher`), but it debounces a full recompute
//! over every historical transcript. The live path must not wait on that, so it
//! keeps its own watcher on the same directory with a 250ms per-session
//! debounce and an incremental read.
//!
//! # Locking
//!
//! Reading a tail's file and parsing it can take a while (a resumed transcript
//! is megabytes), so that work runs under the tail's own mutex and never under
//! the shared maps: they are held only to look an entry up or change the set of
//! tracked sessions. When more than one is needed the order is always
//! `tails`, then `pending`.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use super::live::{LiveSession, SessionTail};
use crate::commands::stats::claude_projects_dir;
use crate::error::AtlasError;
use ts_rs::TS;

/// Per-session gap between emits. Short enough to feel live, long enough that a
/// burst of appends within one Claude turn collapses into one update.
const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SessionUpdateEvent {
    pub session_uuid: String,
    pub session: LiveSession,
}

/// A tail plus what it answers to. The transcript path is fixed for the life
/// of the entry, so ownership can be decided without taking the tail's mutex,
/// which is held for the whole of a read.
struct Tracked {
    transcript: PathBuf,
    tail: Mutex<SessionTail>,
}

impl Tracked {
    /// True when `path` is `uuid`'s transcript, or one of its sidecar writes.
    fn owns(&self, uuid: &str, path: &Path) -> bool {
        self.transcript == path || owns_sidecar(&self.transcript, uuid, path)
    }

    fn claude(session_uuid: &str, path: PathBuf) -> Arc<Self> {
        Arc::new(Tracked {
            tail: Mutex::new(SessionTail::new(session_uuid.to_string(), path.clone())),
            transcript: path,
        })
    }
}

#[derive(Clone, Default)]
pub struct LiveSessionManager {
    tails: Arc<Mutex<HashMap<String, Arc<Tracked>>>>,
    /// Sessions Atlas has spawned whose transcript does not exist yet.
    ///
    /// Claude Code writes the file well after the spawn — cold start plus the
    /// first turn — so waiting for it inline means picking a timeout, and any
    /// timeout is either too short (the tail never starts) or a stall. Instead
    /// the uuid is registered here and the watcher, which already sees every
    /// write under `~/.claude/projects`, attaches the tail the moment the file
    /// turns up.
    pending: Arc<Mutex<HashSet<String>>>,
    watch: Arc<Mutex<Option<RecommendedWatcher>>>,
}

impl LiveSessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn tracked(&self, session_uuid: &str) -> Option<Arc<Tracked>> {
        self.tails.lock().ok()?.get(session_uuid).cloned()
    }

    /// Begin tailing `path` for a session registered with `expect`, returning
    /// the state read so far. `None` when the session has been stopped since it
    /// was registered: a `stop` that lands while the caller was looking for the
    /// transcript must win, or the tail would outlive its tab.
    ///
    /// A session the watcher already attached (the transcript appeared first)
    /// just reports its current state.
    pub fn start_if_pending(&self, session_uuid: &str, path: PathBuf) -> Option<LiveSession> {
        let tracked = {
            let mut tails = self.tails.lock().ok()?;
            let was_pending = self.pending.lock().ok()?.remove(session_uuid);
            match tails.get(session_uuid) {
                Some(tracked) => tracked.clone(),
                None if was_pending => tails
                    .entry(session_uuid.to_string())
                    .or_insert_with(|| Tracked::claude(session_uuid, path))
                    .clone(),
                None => return None,
            }
        };
        let mut tail = tracked.tail.lock().ok()?;
        tail.poll();
        Some(tail.session().clone())
    }

    /// Register a session to be tailed as soon as its transcript appears.
    pub fn expect(&self, session_uuid: &str) -> Result<(), AtlasError> {
        let mut pending = self.pending.lock()?;
        pending.insert(session_uuid.to_string());
        Ok(())
    }

    /// Forget a session. Its pending registration goes first, so a start racing
    /// with this sees it gone and does not re-add a tail.
    pub fn stop(&self, session_uuid: &str) -> Result<(), AtlasError> {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(session_uuid);
        }
        let mut tails = self.tails.lock()?;
        tails.remove(session_uuid);
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

    /// True while `session_uuid` has a tail.
    fn is_tracked(&self, session_uuid: &str) -> bool {
        self.tails
            .lock()
            .is_ok_and(|tails| tails.contains_key(session_uuid))
    }

    /// If `path` is the transcript of a pending session, begin tailing it.
    /// Returns the uuid when a tail was newly attached.
    ///
    /// The tail is attached unread: the watcher's next `poll` does the
    /// first read and so reports it. Reading here would leave that poll
    /// with nothing new, and the first turn unshown until the file grew again.
    fn adopt_pending(&self, path: &Path) -> Option<String> {
        if path.extension()? != "jsonl" {
            return None;
        }
        let uuid = path.file_stem()?.to_str()?.to_string();
        let mut tails = self.tails.lock().ok()?;
        if !self.pending.lock().ok()?.remove(&uuid) {
            return None;
        }
        tails
            .entry(uuid.clone())
            .or_insert_with(|| Tracked::claude(&uuid, path.to_path_buf()));
        Some(uuid)
    }

    /// The live state of a tracked session. Test-only: the UI never polls it,
    /// updates arrive as `session-update` events.
    #[cfg(test)]
    pub fn get(&self, session_uuid: &str) -> Result<Option<LiveSession>, AtlasError> {
        let Some(tracked) = self.tracked(session_uuid) else {
            return Ok(None);
        };
        let tail = tracked.tail.lock()?;
        Ok(Some(tail.session().clone()))
    }

    /// The session whose transcript is `path`, if it is one we track.
    fn uuid_for_path(&self, path: &Path) -> Option<String> {
        let tails = self.tails.lock().ok()?;
        tails
            .iter()
            .find(|(uuid, tracked)| tracked.owns(uuid, path))
            .map(|(uuid, _)| uuid.clone())
    }

    /// Fold in whatever has been appended. `None` when nothing changed.
    fn poll(&self, session_uuid: &str) -> Option<LiveSession> {
        let tracked = self.tracked(session_uuid)?;
        let mut tail = tracked.tail.lock().ok()?;
        tail.poll().then(|| tail.session().clone())
    }
}

/// A session's sidecar writes — `<uuid>/subagents/*`, `<uuid>/workflows/*` —
/// sit beside its transcript and change its live state too, but they are not
/// the transcript, so the watcher has to attribute them to it by directory.
/// Without this a workflow's agents only surface when the parent transcript
/// next grows, which during a run can be minutes.
fn owns_sidecar(transcript: &Path, uuid: &str, path: &Path) -> bool {
    transcript
        .parent()
        .map(|dir| path.starts_with(dir.join(uuid)))
        .unwrap_or(false)
}

/// Per-session emit throttle with a trailing edge.
///
/// A write inside `DEBOUNCE` of the last emit used to be skipped outright, so
/// the last write of a burst — a `tool_result` lands milliseconds after
/// its `tool_use` — was never reported until the file grew again, and a card
/// sat on a finished tool until the next turn. Marking the session instead
/// and flushing it once the window closes keeps the leading-edge emit and
/// guarantees the trailing one.
#[derive(Default)]
struct Throttle {
    last_emit: HashMap<String, Instant>,
    dirty: HashSet<String>,
}

impl Throttle {
    fn mark(&mut self, uuid: String) {
        self.dirty.insert(uuid);
    }

    fn due_at(&self, uuid: &str, now: Instant) -> Instant {
        self.last_emit.get(uuid).map_or(now, |at| *at + DEBOUNCE)
    }

    /// When the soonest dirty session comes due; `None` with nothing dirty.
    fn next_due(&self, now: Instant) -> Option<Instant> {
        self.dirty.iter().map(|uuid| self.due_at(uuid, now)).min()
    }

    /// Dirty sessions whose window has closed, stamped as emitted at `now`.
    fn take_due(&mut self, now: Instant) -> Vec<String> {
        let due: Vec<String> = self
            .dirty
            .iter()
            .filter(|uuid| self.due_at(uuid, now) <= now)
            .cloned()
            .collect();
        for uuid in &due {
            self.dirty.remove(uuid);
            self.last_emit.insert(uuid.clone(), now);
        }
        due
    }

    /// Drop what is remembered about a session that is no longer tracked, so a
    /// long-lived app does not accumulate one entry per session it ever ran.
    fn forget(&mut self, uuid: &str) {
        self.last_emit.remove(uuid);
        self.dirty.remove(uuid);
    }
}

/// Holds the live watcher alive for the life of the app. `Manager::manage` is
/// keyed by type and the panel and stats watchers are both bare
/// `RecommendedWatcher`, so ours needs a type of its own or it would be
/// dropped on registration.
pub struct LiveWatcher(
    // Held only so the watcher is dropped with app state, never read through this handle.
    #[allow(dead_code)] Arc<Mutex<Option<RecommendedWatcher>>>,
);

pub fn start_live_watcher(
    app_handle: AppHandle,
    manager: LiveSessionManager,
) -> Result<LiveWatcher, AtlasError> {
    let projects_dir = claude_projects_dir()?;
    std::fs::create_dir_all(&projects_dir).map_err(|e| AtlasError::io_at(&projects_dir, &e))?;

    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| match res {
            Ok(event) => {
                let _ = tx.send(event);
            }
            // FSEvents overflow and rescan errors land here; sessions then go
            // stale until their next write, which is worth a line in the log.
            Err(e) => log::warn!("live session watcher error: {}", e),
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(250)),
    )?;

    watcher.watch(&projects_dir, RecursiveMode::Recursive)?;

    if let Ok(mut slot) = manager.watch.lock() {
        *slot = Some(watcher);
    }

    let manager_watch = manager.watch.clone();
    std::thread::spawn(move || {
        let mut throttle = Throttle::default();

        loop {
            let received = match throttle.next_due(Instant::now()) {
                None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
                Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
            };
            match received {
                Ok(event) if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) => {
                    for path in &event.paths {
                        if let Some(uuid) = manager
                            .uuid_for_path(path)
                            // A pending session's file may be appearing for the first time.
                            .or_else(|| manager.adopt_pending(path))
                        {
                            throttle.mark(uuid);
                        }
                    }
                }
                Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            for uuid in throttle.take_due(Instant::now()) {
                match manager.poll(&uuid) {
                    Some(session) => {
                        let _ = app_handle.emit(
                            "session-update",
                            SessionUpdateEvent {
                                session_uuid: uuid,
                                session,
                            },
                        );
                    }
                    None if !manager.is_tracked(&uuid) => throttle.forget(&uuid),
                    None => {}
                }
            }
        }
        log::error!("live session watcher stopped; session updates will no longer arrive");
    });

    Ok(LiveWatcher(manager_watch))
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

    const USER_LINE: &str = r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z"}"#;

    /// What `start_session_tail` does once it has found the transcript.
    fn start(manager: &LiveSessionManager, path: PathBuf) -> LiveSession {
        manager.expect(UUID).unwrap();
        manager
            .start_if_pending(UUID, path)
            .expect("the session was registered")
    }

    #[test]
    fn start_reads_the_transcript_and_get_returns_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        let session = start(&manager, path);
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
        let session = manager
            .poll(UUID)
            .expect("the first read is reported, not swallowed by adoption");
        assert_eq!(session.lines.len(), 1);
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
        assert!(
            !manager.is_pending(UUID),
            "a closed session must not be adopted later"
        );
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

        start(&manager, path);
        manager.stop(UUID).unwrap();
        assert!(manager.get(UUID).unwrap().is_none());
    }

    #[test]
    fn poll_only_reports_a_change_when_the_file_grew() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();
        start(&manager, path.clone());

        assert!(manager.poll(UUID).is_none(), "nothing appended yet");

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
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
        start(&manager, path.clone());

        assert_eq!(manager.uuid_for_path(&path).as_deref(), Some(UUID));
        assert_eq!(manager.uuid_for_path(&dir.path().join("other.jsonl")), None);
    }

    #[test]
    fn starting_twice_keeps_the_existing_offset() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        start(&manager, path.clone());
        let again = start(&manager, path);
        assert_eq!(
            again.lines.len(),
            1,
            "the file is not re-read from the start"
        );
    }

    #[test]
    fn a_sidecar_write_is_attributed_to_the_session_that_owns_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();
        start(&manager, path);

        assert_eq!(
            manager.uuid_for_path(&dir.path().join(UUID).join("workflows").join("wf_x.json")),
            Some(UUID.to_string())
        );
        assert_eq!(
            manager.uuid_for_path(
                &dir.path()
                    .join(UUID)
                    .join("subagents")
                    .join("agent-a.jsonl")
            ),
            Some(UUID.to_string())
        );
        assert_eq!(
            manager.uuid_for_path(&dir.path().join("other-uuid.jsonl")),
            None
        );
        assert_eq!(
            manager.uuid_for_path(&dir.path().join(format!("{}-other", UUID)).join("x.json")),
            None,
            "a sibling dir that merely shares a prefix must not match"
        );
    }

    /// A `tool_result` lands milliseconds after the `tool_use` that was
    /// just emitted. That second write must still be reported once the window
    /// closes — dropping it left a card on a finished tool until the next turn.
    #[test]
    fn a_write_inside_the_window_is_flushed_when_it_closes() {
        let mut throttle = Throttle::default();
        let t0 = Instant::now();

        throttle.mark("a".into());
        assert_eq!(throttle.take_due(t0), vec!["a".to_string()], "leading edge");

        let inside = t0 + DEBOUNCE / 10;
        throttle.mark("a".into());
        assert!(
            throttle.take_due(inside).is_empty(),
            "held inside the window"
        );
        assert_eq!(throttle.next_due(inside), Some(t0 + DEBOUNCE));
        assert_eq!(
            throttle.take_due(t0 + DEBOUNCE),
            vec!["a".to_string()],
            "trailing edge"
        );
        assert_eq!(throttle.next_due(t0 + DEBOUNCE), None, "nothing left dirty");
    }

    /// A resumed session's transcript already exists, so nothing will change
    /// it and the watcher has nothing to report: the start itself must hand
    /// back the state, or the tile stays empty until the next write.
    #[test]
    fn starting_on_an_existing_transcript_returns_its_state_and_leaves_nothing_for_poll() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        let session = start(&manager, path);
        assert_eq!(session.lines.len(), 1);
        assert!(manager.poll(UUID).is_none());
    }

    /// `stop_session_tail` can land while `start_session_tail` is still looking
    /// for the transcript. The stop must win: no tail, and nothing left pending.
    #[test]
    fn a_stop_that_lands_before_the_start_completes_wins() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        manager.expect(UUID).unwrap();
        manager.stop(UUID).unwrap();

        assert!(manager.start_if_pending(UUID, path).is_none());
        assert!(manager.get(UUID).unwrap().is_none());
        assert!(!manager.is_pending(UUID));
    }

    /// File IO runs under a tail's own lock, not the shared map's: a slow read
    /// of one session must not stall the rest.
    #[test]
    fn a_tail_busy_reading_does_not_block_other_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();
        start(&manager, path.clone());

        let busy = manager.tracked(UUID).unwrap();
        let _reading = busy.tail.lock().unwrap();

        assert_eq!(manager.uuid_for_path(&path).as_deref(), Some(UUID));
        manager.expect("other").unwrap();
        manager.stop("other").unwrap();
        assert!(manager.is_tracked(UUID));
    }

    #[test]
    fn a_stopped_session_is_dropped_from_the_throttle() {
        let mut throttle = Throttle::default();
        let t0 = Instant::now();
        throttle.mark("a".into());
        throttle.take_due(t0);
        throttle.mark("a".into());

        throttle.forget("a");
        assert!(throttle.last_emit.is_empty());
        assert_eq!(throttle.next_due(t0), None);
    }
}
