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
//! `tails`, then `pending` or `omp_watches`.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

use super::live::{LiveSession, SessionTail};
use super::omp::{self, OmpTail};
use crate::commands::stats::claude_projects_dir;
use crate::error::AtlasError;

/// Per-session gap between emits. Short enough to feel live, long enough that a
/// burst of appends within one Claude turn collapses into one update.
const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
pub struct SessionUpdateEvent {
    pub session_uuid: String,
    pub session: LiveSession,
}

/// One session's tail, from whichever harness is running it.
enum Tail {
    Claude(Box<SessionTail>),
    Omp(Box<OmpTail>),
}

impl Tail {
    fn session(&self) -> &LiveSession {
        match self {
            Tail::Claude(tail) => tail.session(),
            Tail::Omp(tail) => tail.session(),
        }
    }

    fn poll(&mut self) -> bool {
        match self {
            Tail::Claude(tail) => tail.poll(),
            Tail::Omp(tail) => tail.poll(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Harness {
    Claude,
    Omp,
}

/// A tail plus what it answers to. The transcript path is fixed for the life
/// of the entry, so ownership can be decided without taking the tail's mutex,
/// which is held for the whole of a read.
struct Tracked {
    harness: Harness,
    transcript: PathBuf,
    tail: Mutex<Tail>,
}

impl Tracked {
    /// True when `path` is `uuid`'s transcript, or one of its sidecar writes.
    fn owns(&self, uuid: &str, path: &Path) -> bool {
        match self.harness {
            Harness::Claude => {
                self.transcript == path || owns_sidecar(&self.transcript, uuid, path)
            }
            Harness::Omp => omp::owns_transcript(&self.transcript, path),
        }
    }

    fn claude(session_uuid: &str, path: PathBuf) -> Arc<Self> {
        Arc::new(Tracked {
            harness: Harness::Claude,
            tail: Mutex::new(Tail::Claude(Box::new(SessionTail::new(
                session_uuid.to_string(),
                path.clone(),
            )))),
            transcript: path,
        })
    }
}

/// A terminal Atlas is watching for OMP's own breadcrumb — see
/// `omp::read_breadcrumb`.
#[derive(Clone)]
struct OmpWatch {
    breadcrumb: PathBuf,
    since: SystemTime,
}

/// The filesystem watcher, shared so an OMP directory that appears after launch
/// can still be added to it.
struct LiveWatch {
    watcher: RecommendedWatcher,
    omp_dir: Option<PathBuf>,
    omp_watched: bool,
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
    /// OMP sessions being resolved through their terminal's breadcrumb rather
    /// than a known transcript path.
    omp_watches: Arc<Mutex<HashMap<String, OmpWatch>>>,
    watch: Arc<Mutex<Option<LiveWatch>>>,
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

    /// Make sure the OMP directory is being watched, adding it now if it did
    /// not exist when Atlas launched. Failure is logged, never fatal: Claude
    /// tailing does not depend on it.
    fn ensure_omp_watched(&self) {
        let Ok(mut guard) = self.watch.lock() else {
            return;
        };
        let Some(live) = guard.as_mut() else {
            return;
        };
        if live.omp_watched {
            return;
        }
        let Some(dir) = live.omp_dir.clone().filter(|dir| dir.exists()) else {
            return;
        };
        match live.watcher.watch(&dir, RecursiveMode::Recursive) {
            Ok(()) => live.omp_watched = true,
            Err(e) => log::warn!("Failed to watch {}: {}", dir.display(), e),
        }
    }

    /// Begin tailing an OMP session through its terminal's breadcrumb file,
    /// returning the state read so far. Re-watching an already-tracked session
    /// just re-resolves the breadcrumb — see `resolve_omp`.
    pub fn watch_omp(
        &self,
        session_uuid: &str,
        breadcrumb: PathBuf,
        since: SystemTime,
    ) -> Option<LiveSession> {
        if let Ok(mut watches) = self.omp_watches.lock() {
            watches.insert(session_uuid.to_string(), OmpWatch { breadcrumb, since });
        }
        self.ensure_omp_watched();
        self.resolve_omp(session_uuid)
    }

    /// Read `session_uuid`'s breadcrumb and attach or advance its tail. `None`
    /// when the breadcrumb names nothing yet, or nothing changed.
    fn resolve_omp(&self, session_uuid: &str) -> Option<LiveSession> {
        let watch = {
            let watches = self.omp_watches.lock().ok()?;
            watches.get(session_uuid)?.clone()
        };
        let target = omp::read_breadcrumb(&watch.breadcrumb, watch.since)?;
        if !target.is_file() {
            return None;
        }

        if let Some(tracked) = self.tracked(session_uuid) {
            if tracked.harness == Harness::Omp && tracked.transcript == target {
                let mut tail = tracked.tail.lock().ok()?;
                return tail.poll().then(|| tail.session().clone());
            }
        }

        // A new file: read it before it is shared, so no lock is held for the read.
        let mut tail = OmpTail::new(session_uuid.to_string(), target.clone());
        tail.poll();
        let session = tail.session().clone();
        let tracked = Arc::new(Tracked {
            harness: Harness::Omp,
            transcript: target,
            tail: Mutex::new(Tail::Omp(Box::new(tail))),
        });

        let mut tails = self.tails.lock().ok()?;
        // `stop` removes the watch before the tail, so a watch that is gone here
        // means the session was stopped while its file was being read.
        if !self.omp_watches.lock().ok()?.contains_key(session_uuid) {
            return None;
        }
        tails.insert(session_uuid.to_string(), tracked);
        Some(session)
    }

    /// Every OMP watch whose transcript `path` may belong to. Nothing is read
    /// from the transcripts: the watcher resolves each one when its throttle
    /// comes due, so a write inside the window is folded in then rather than
    /// read and dropped.
    fn omp_owners(&self, path: &Path) -> Vec<String> {
        let Ok(watches) = self.omp_watches.lock() else {
            return Vec::new();
        };
        let watches: Vec<(String, OmpWatch)> = watches
            .iter()
            .map(|(uuid, watch)| (uuid.clone(), watch.clone()))
            .collect();
        watches
            .into_iter()
            .filter(|(uuid, watch)| {
                if path == watch.breadcrumb {
                    return true;
                }
                match self.tracked(uuid) {
                    None => true,
                    Some(tracked) => {
                        tracked.owns(uuid, path)
                            // The breadcrumb can name a file before that file
                            // exists; its creation then belongs to this watch too.
                            || omp::read_breadcrumb(&watch.breadcrumb, watch.since).as_deref()
                                == Some(path)
                    }
                }
            })
            .map(|(uuid, _)| uuid)
            .collect()
    }

    /// Fold in whatever `session_uuid`'s transcript gained since the last
    /// read, re-resolving an OMP session's breadcrumb first. `None` when
    /// nothing changed.
    fn refresh(&self, session_uuid: &str) -> Option<LiveSession> {
        let is_omp = self.omp_watches.lock().ok()?.contains_key(session_uuid);
        if is_omp {
            self.resolve_omp(session_uuid)
        } else {
            self.poll(session_uuid)
        }
    }

    /// Register a session to be tailed as soon as its transcript appears.
    pub fn expect(&self, session_uuid: &str) -> Result<(), AtlasError> {
        let mut pending = self.pending.lock()?;
        pending.insert(session_uuid.to_string());
        Ok(())
    }

    /// Forget a session. Its pending registration and OMP watch go first, so a
    /// start or a resolve racing with this sees it gone and does not re-add a tail.
    pub fn stop(&self, session_uuid: &str) -> Result<(), AtlasError> {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(session_uuid);
        }
        if let Ok(mut watches) = self.omp_watches.lock() {
            watches.remove(session_uuid);
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

    /// True while `session_uuid` has a tail or an OMP watch.
    fn is_tracked(&self, session_uuid: &str) -> bool {
        let tailed = self
            .tails
            .lock()
            .is_ok_and(|tails| tails.contains_key(session_uuid));
        tailed
            || self
                .omp_watches
                .lock()
                .is_ok_and(|watches| watches.contains_key(session_uuid))
    }

    /// If `path` is the transcript of a pending session, begin tailing it.
    /// Returns the uuid when a tail was newly attached.
    ///
    /// The tail is attached unread: the watcher's next `refresh` does the
    /// first read and so reports it. Reading here would leave that refresh
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
/// the last write of a burst — an OMP `toolResult` lands milliseconds after
/// its `toolCall` — was never reported until the file grew again, and a card
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
    #[allow(dead_code)] Arc<Mutex<Option<LiveWatch>>>,
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

    // OMP is optional. A failure to watch its directory must not take Claude
    // tailing down with it, and a directory that does not exist yet is added
    // by `ensure_omp_watched` when the first OMP session starts.
    let omp_dir = omp::agent_dir();
    let mut omp_watched = false;
    if let Some(dir) = omp_dir.as_ref().filter(|dir| dir.exists()) {
        match watcher.watch(dir, RecursiveMode::Recursive) {
            Ok(()) => omp_watched = true,
            Err(e) => log::warn!("Failed to watch {}: {}", dir.display(), e),
        }
    }
    if let Ok(mut slot) = manager.watch.lock() {
        *slot = Some(LiveWatch {
            watcher,
            omp_dir: omp_dir.clone(),
            omp_watched,
        });
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
                        if omp_dir.as_deref().is_some_and(|dir| path.starts_with(dir)) {
                            for uuid in manager.omp_owners(path) {
                                throttle.mark(uuid);
                            }
                        } else if let Some(uuid) = manager
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
                match manager.refresh(&uuid) {
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
            .refresh(UUID)
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

    fn write_breadcrumb(path: &Path, target: &Path) {
        std::fs::write(path, format!("pid 1\n{}\n", target.display())).unwrap();
    }

    fn write_omp_title(path: &Path, title: &str) {
        std::fs::write(
            path,
            format!(
                "{}\n",
                serde_json::json!({"type": "title", "timestamp": "2026-01-01T00:00:00Z", "title": title})
            ),
        )
        .unwrap();
    }

    #[test]
    fn an_omp_watch_attaches_when_the_breadcrumb_names_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("session.jsonl");
        write_omp_title(&target, "first");
        let breadcrumb = dir.path().join("breadcrumb");
        write_breadcrumb(&breadcrumb, &target);

        let manager = LiveSessionManager::new();
        let session = manager
            .watch_omp("uuid-1", breadcrumb, std::time::SystemTime::UNIX_EPOCH)
            .expect("the breadcrumb names an existing file");
        assert_eq!(session.session_uuid, "uuid-1");
        assert_eq!(session.title.as_deref(), Some("first"));
    }

    #[test]
    fn a_rewritten_breadcrumb_switches_the_tail_to_the_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.jsonl");
        write_omp_title(&first, "first");
        let breadcrumb = dir.path().join("breadcrumb");
        write_breadcrumb(&breadcrumb, &first);

        let manager = LiveSessionManager::new();
        let session = manager
            .watch_omp(
                "uuid-1",
                breadcrumb.clone(),
                std::time::SystemTime::UNIX_EPOCH,
            )
            .unwrap();
        assert_eq!(session.title.as_deref(), Some("first"));

        let second = dir.path().join("second.jsonl");
        write_omp_title(&second, "second");
        write_breadcrumb(&breadcrumb, &second);

        let session = manager
            .watch_omp("uuid-1", breadcrumb, std::time::SystemTime::UNIX_EPOCH)
            .expect("resolves to the new target");
        assert_eq!(
            session.title.as_deref(),
            Some("second"),
            "the tail switched files"
        );
    }

    #[test]
    fn stop_drops_the_omp_watch() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("session.jsonl");
        write_omp_title(&target, "first");
        let breadcrumb = dir.path().join("breadcrumb");
        write_breadcrumb(&breadcrumb, &target);

        let manager = LiveSessionManager::new();
        manager
            .watch_omp(
                "uuid-1",
                breadcrumb.clone(),
                std::time::SystemTime::UNIX_EPOCH,
            )
            .unwrap();
        manager.stop("uuid-1").unwrap();

        assert!(
            manager.get("uuid-1").unwrap().is_none(),
            "the tail is dropped"
        );
        assert!(
            manager.omp_owners(&breadcrumb).is_empty(),
            "a stopped session's watch no longer claims writes"
        );
    }

    /// An OMP `toolResult` lands milliseconds after the `toolCall` that was
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
    fn starting_on_an_existing_transcript_returns_its_state_and_leaves_nothing_for_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let path = transcript(dir.path(), USER_LINE);
        let manager = LiveSessionManager::new();

        let session = start(&manager, path);
        assert_eq!(session.lines.len(), 1);
        assert!(manager.refresh(UUID).is_none());
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

    /// A breadcrumb can be rewritten to name a transcript OMP has not created
    /// yet; when it appears, its creation event has to reach this watch.
    #[test]
    fn a_file_the_breadcrumb_names_before_it_exists_is_claimed_when_created() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.jsonl");
        write_omp_title(&first, "first");
        let breadcrumb = dir.path().join("breadcrumb");
        write_breadcrumb(&breadcrumb, &first);

        let manager = LiveSessionManager::new();
        manager
            .watch_omp(
                "uuid-1",
                breadcrumb.clone(),
                std::time::SystemTime::UNIX_EPOCH,
            )
            .unwrap();

        let second = dir.path().join("second.jsonl");
        write_breadcrumb(&breadcrumb, &second);
        assert!(manager.refresh("uuid-1").is_none(), "nothing to read yet");

        write_omp_title(&second, "second");
        assert!(manager.omp_owners(&second).contains(&"uuid-1".to_string()));
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
