//! Language server hosting.
//!
//! One child process per (workspace, language), speaking LSP over stdio. The
//! frontend talks JSON-RPC and never sees a Content-Length header: framing is
//! `frame.rs`'s job, so `@codemirror/lsp-client`'s `Transport` can hand over
//! bare messages.
//!
//! Nothing here understands LSP semantics. Messages are relayed both ways and
//! the client owns the protocol, which keeps the Rust side small and means a
//! new request type needs no change on this side of the wire.

pub mod frame;
pub mod server;

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{AppHandle, Emitter};

use frame::{frame, FrameReader};

use crate::error::AtlasError;
use crate::state::{StateFile, StateStore};
use ts_rs::TS;

/// A message relayed from a server to the frontend.
#[derive(Clone, serde::Serialize, TS)]
#[ts(export)]
pub struct LspMessage {
    /// The session this belongs to — `<language>:<workspace root>`.
    pub id: String,
    /// One JSON-RPC message, no headers.
    pub message: String,
}

/// The `lsp-exit` event: a server's output closed, so it crashed or exited on
/// its own, and the session has been removed. The frontend drops what it cached
/// for `id`; the next editor to need one starts a fresh server. Not sent for an
/// explicit `lsp_stop`.
#[derive(Clone, serde::Serialize, TS)]
#[ts(export)]
pub struct LspExit {
    pub id: String,
}

/// What `lsp_start` found.
#[derive(Debug, PartialEq, serde::Serialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LspStart {
    /// A server is running; use `id` with `lsp_send`.
    Started { id: String },
    /// Language servers are off for this workspace (the default). Nothing was
    /// resolved or run.
    NotTrusted,
    /// Trusted, but no server for this language is installed.
    NoServer,
}

struct Session {
    child: Child,
    /// Framed messages waiting for the writer thread to put them on the
    /// server's stdin. Sending never blocks, so a stalled server cannot freeze
    /// the command thread (or, through it, every other language server).
    outbox: SyncSender<Vec<u8>>,
}

/// How many messages may queue for one server before it is declared stuck.
const OUTBOX_CAPACITY: usize = 1024;

/// How many stderr lines per server reach Atlas's log; a chatty server would
/// otherwise grow the daily log without bound.
const MAX_STDERR_LOG_LINES: usize = 200;

/// Move `sink` onto its own thread and return the queue that feeds it. Order is
/// preserved; the thread ends when the queue is dropped or a write fails.
fn spawn_writer<W: Write + Send + 'static>(mut sink: W) -> SyncSender<Vec<u8>> {
    let (tx, rx) = sync_channel::<Vec<u8>>(OUTBOX_CAPACITY);
    thread::spawn(move || {
        for bytes in rx {
            if sink.write_all(&bytes).and_then(|_| sink.flush()).is_err() {
                break;
            }
        }
    });
    tx
}

impl Session {
    /// True while the server process is still running. A server that crashed
    /// leaves a dead entry that would otherwise be handed out forever.
    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

/// Every running server, keyed by session id.
#[derive(Default)]
pub struct LspManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Kill every running server. Called on app exit, so a language server
    /// (rust-analyzer can hold gigabytes) never outlives Atlas.
    pub fn stop_all(&self) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        for (id, mut session) in sessions.drain() {
            let _ = session.child.kill();
            let _ = session.child.wait();
            log::info!("stopped language server {} on exit", id);
        }
    }
}

/// The workspace root as an existing absolute directory. It becomes the
/// server's working directory and the only place project-local servers are
/// looked up, so a relative or missing path is refused rather than resolved
/// against whatever Atlas's own working directory happens to be.
fn validate_root(root: &str) -> Result<std::path::PathBuf, AtlasError> {
    let path = std::path::Path::new(root);
    if !path.is_absolute() {
        return Err(AtlasError::invalid_input(format!(
            "workspace root must be an absolute path: {root}"
        )));
    }
    if !path.is_dir() {
        return Err(AtlasError::not_found(format!(
            "workspace root is not a directory: {root}"
        )));
    }
    Ok(path.to_path_buf())
}

/// Whether the user turned language servers on for `root`: it is, or lies
/// inside, a path listed under `lspTrustedWorkspaces` in `settings.json`.
///
/// Rust reads that file itself; the webview cannot assert trust. Servers run
/// project code (rust-analyzer executes build scripts and proc macros,
/// tsserver loads plugins named in tsconfig, and `node_modules/.bin` is
/// resolved from the workspace), so merely opening a file from a cloned repo
/// must not start one. Paths are compared canonically, so a symlinked spelling
/// of a trusted workspace is still that workspace.
fn is_trusted(settings: Option<&serde_json::Value>, root: &Path) -> bool {
    let Some(list) = settings
        .and_then(|s| s.get("lspTrustedWorkspaces"))
        .and_then(|v| v.as_array())
    else {
        return false;
    };
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    list.iter()
        .filter_map(|v| v.as_str())
        .map(Path::new)
        .filter(|p| p.is_absolute())
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .any(|trusted| root.starts_with(trusted))
}

/// Remove `id` from `sessions` if it is still the session whose child has
/// process id `pid`, then kill and reap that child. False when the session was
/// already stopped or replaced by a newer server for the same pair, which this
/// must not disturb.
fn evict(sessions: &Mutex<HashMap<String, Session>>, id: &str, pid: u32) -> bool {
    let removed = {
        let Ok(mut sessions) = sessions.lock() else {
            return false;
        };
        if sessions.get(id).is_some_and(|s| s.child.id() == pid) {
            sessions.remove(id)
        } else {
            None
        }
    };
    let Some(mut session) = removed else {
        return false;
    };
    let _ = session.child.kill();
    let _ = session.child.wait();
    true
}

/// The session id for a workspace and language. Deriving it rather than handing
/// out a random one means a second editor on the same language reuses the
/// server it already has, which is the expensive thing to start.
fn session_id(language_id: &str, root: &str) -> String {
    format!("{language_id}:{root}")
}

/// Start a server for `language_id` rooted at `root`, if the user trusts that
/// workspace and one is installed. `LspStart::Started` carries the session id
/// to use with `lsp_send`.
///
/// Starting twice for the same pair is a no-op that returns the same id.
#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    manager: tauri::State<'_, LspManager>,
    state: tauri::State<'_, StateStore>,
    language_id: String,
    root: String,
) -> Result<LspStart, AtlasError> {
    let root_dir = validate_root(&root)?;
    if !is_trusted(state.read_json(StateFile::Settings).as_ref(), &root_dir) {
        return Ok(LspStart::NotTrusted);
    }
    let id = session_id(&language_id, &root);
    {
        let mut sessions = manager.sessions.lock()?;
        let alive = sessions.get_mut(&id).map(Session::is_alive);
        match alive {
            Some(true) => return Ok(LspStart::Started { id }),
            Some(false) => {
                if let Some(mut dead) = sessions.remove(&id) {
                    let _ = dead.child.wait();
                }
                log::warn!("language server {} had exited; starting a new one", id);
            }
            None => {}
        }
    }

    let Some(spec) = server::resolve(&language_id, &root_dir) else {
        return Ok(LspStart::NoServer);
    };

    let mut command = Command::new(&spec.command);
    command
        .args(&spec.args)
        .current_dir(&root_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // Without this a console window flashes up for every server. [UNVERIFIED on Windows]
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let program = spec.command.display().to_string();
    let mut child = command.spawn().map_err(|e| {
        let message = format!("could not start {program}: {e}");
        if e.kind() == std::io::ErrorKind::NotFound {
            AtlasError::tool_missing(&program, message)
        } else {
            AtlasError::tool_failed(&program, message)
        }
    })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AtlasError::internal("no stdin on the language server"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AtlasError::internal("no stdout on the language server"))?;
    let stderr = child.stderr.take();
    let pid = child.id();

    // Relay stdout. A server writes as it pleases, so the reader owns a
    // `FrameReader` across reads rather than assuming one chunk is one message.
    let emit_id = id.clone();
    let emit_app = app.clone();
    let reader_sessions = Arc::clone(&manager.sessions);
    thread::spawn(move || {
        use std::io::Read;
        let mut reader = FrameReader::new();
        let mut stdout = stdout;
        let mut chunk = [0u8; 8192];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for message in reader.push(&chunk[..n]) {
                        let _ = emit_app.emit(
                            "lsp-message",
                            LspMessage {
                                id: emit_id.clone(),
                                message,
                            },
                        );
                    }
                }
            }
        }
        log::info!("language server {} closed its output", emit_id);
        // The server is gone (or useless without its output): drop the dead
        // session so the next start replaces it, reap the child so it does not
        // linger defunct, and tell the frontend to forget its client.
        if evict(&reader_sessions, &emit_id, pid) {
            let _ = emit_app.emit("lsp-exit", LspExit { id: emit_id });
        }
    });

    // A server's stderr is diagnostics about the server, not about the code.
    // It goes to Atlas's log so a server that will not start says why.
    if let Some(stderr) = stderr {
        let log_id = id.clone();
        thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let lines = BufReader::new(stderr).lines().map_while(Result::ok);
            for (n, line) in lines.enumerate() {
                if n == MAX_STDERR_LOG_LINES {
                    log::warn!("[lsp {}] further stderr output not logged", log_id);
                }
                if n < MAX_STDERR_LOG_LINES {
                    log::warn!("[lsp {}] {}", log_id, line);
                }
            }
        });
    }

    manager.sessions.lock()?.insert(
        id.clone(),
        Session {
            child,
            outbox: spawn_writer(stdin),
        },
    );
    log::info!(
        "started language server {} ({})",
        id,
        spec.command.display()
    );
    Ok(LspStart::Started { id })
}

/// Relay one JSON-RPC message to a running server.
#[tauri::command]
pub fn lsp_send(
    manager: tauri::State<'_, LspManager>,
    id: String,
    message: String,
) -> Result<(), AtlasError> {
    let sessions = manager.sessions.lock()?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| AtlasError::not_found(format!("no language server session {id}")))?;
    session
        .outbox
        .try_send(frame(&message))
        .map_err(|_| AtlasError::io(format!("language server {id} is not accepting input")))
}

/// Stop a server. Idempotent. The frontend calls it when the user turns
/// language servers off for a workspace, so nothing keeps running project code
/// after trust is withdrawn.
#[tauri::command]
pub fn lsp_stop(manager: tauri::State<'_, LspManager>, id: String) -> Result<(), AtlasError> {
    let mut sessions = manager.sessions.lock()?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
        log::info!("stopped language server {}", id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_id_is_the_language_and_the_root() {
        assert_eq!(session_id("rust", "/repo"), "rust:/repo");
    }

    /* Two editors on the same language in the same workspace must land on one
    server — starting rust-analyzer twice for one repo indexes it twice. */
    #[test]
    fn the_same_language_and_root_is_the_same_session() {
        assert_eq!(
            session_id("typescript", "/a"),
            session_id("typescript", "/a")
        );
        assert_ne!(
            session_id("typescript", "/a"),
            session_id("typescript", "/b")
        );
        assert_ne!(
            session_id("typescript", "/a"),
            session_id("javascript", "/a")
        );
    }

    #[test]
    fn a_relative_or_missing_root_is_refused() {
        assert!(matches!(
            validate_root("repo"),
            Err(AtlasError::InvalidInput { .. })
        ));
        assert!(matches!(
            validate_root(""),
            Err(AtlasError::InvalidInput { .. })
        ));
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_root(dir.path().to_str().unwrap()).is_ok());
        assert!(matches!(
            validate_root(dir.path().join("missing").to_str().unwrap()),
            Err(AtlasError::NotFound { .. })
        ));
    }

    /// A sink that never accepts a byte, like a server that stopped reading.
    struct Stalled(std::sync::mpsc::Receiver<()>);
    impl Write for Stalled {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            let _ = self.0.recv();
            Ok(0)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_stalled_server_makes_send_fail_instead_of_blocking() {
        let (_keep_open, gate) = std::sync::mpsc::channel::<()>();
        let outbox = spawn_writer(Stalled(gate));
        let sent = (0..OUTBOX_CAPACITY + 8)
            .filter(|_| outbox.try_send(vec![0u8; 8]).is_ok())
            .count();
        // One message may be in the writer's hands; the rest fill the queue.
        assert!(sent <= OUTBOX_CAPACITY + 1, "sent {sent}");
    }

    #[derive(Clone, Default)]
    struct Shared(Arc<Mutex<Vec<u8>>>);
    impl Write for Shared {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn queued_messages_reach_the_server_in_order() {
        let sink = Shared::default();
        let outbox = spawn_writer(sink.clone());
        for byte in b"abc" {
            outbox.send(vec![*byte]).unwrap();
        }
        drop(outbox);
        // The writer drains the queue, then exits; wait for it to catch up.
        for _ in 0..200 {
            if sink.0.lock().unwrap().len() == 3 {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(sink.0.lock().unwrap().as_slice(), b"abc");
    }

    #[cfg(unix)]
    #[test]
    fn an_exited_server_is_not_alive() {
        let mut child = Command::new("true").stdin(Stdio::piped()).spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut session = Session {
            child,
            outbox: spawn_writer(stdin),
        };
        for _ in 0..200 {
            if !session.is_alive() {
                return;
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("session still reported alive after its process exited");
    }

    fn settings_trusting(paths: &[&Path]) -> serde_json::Value {
        serde_json::json!({ "lspTrustedWorkspaces": paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>() })
    }

    #[test]
    fn language_servers_are_off_unless_the_workspace_is_listed() {
        let ws = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();

        // No settings file, no key, an empty list, a different workspace.
        assert!(!is_trusted(None, ws.path()));
        assert!(!is_trusted(Some(&serde_json::json!({})), ws.path()));
        assert!(!is_trusted(Some(&settings_trusting(&[])), ws.path()));
        assert!(!is_trusted(
            Some(&settings_trusting(&[other.path()])),
            ws.path()
        ));
        assert!(is_trusted(
            Some(&settings_trusting(&[ws.path()])),
            ws.path()
        ));
    }

    #[test]
    fn a_folder_inside_a_trusted_workspace_is_trusted_but_a_parent_is_not() {
        let ws = tempfile::tempdir().unwrap();
        let inner = ws.path().join("packages/app");
        std::fs::create_dir_all(&inner).unwrap();
        let settings = settings_trusting(&[&inner]);

        assert!(is_trusted(Some(&settings), &inner));
        assert!(is_trusted(Some(&settings_trusting(&[ws.path()])), &inner));
        assert!(!is_trusted(Some(&settings), ws.path()));
    }

    #[test]
    fn trust_entries_that_are_not_absolute_existing_strings_grant_nothing() {
        let ws = tempfile::tempdir().unwrap();
        let settings = serde_json::json!({
            "lspTrustedWorkspaces": ["relative/dir", 7, null, ws.path().join("gone")]
        });
        assert!(!is_trusted(Some(&settings), ws.path()));
        // A malformed key is not a list at all.
        assert!(!is_trusted(
            Some(&serde_json::json!({ "lspTrustedWorkspaces": true })),
            ws.path()
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_spelling_of_a_trusted_workspace_is_that_workspace() {
        let real = tempfile::tempdir().unwrap();
        let holder = tempfile::tempdir().unwrap();
        let link = holder.path().join("alias");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        assert!(is_trusted(Some(&settings_trusting(&[real.path()])), &link));
    }

    #[cfg(unix)]
    fn sleeping_session(sessions: &Mutex<HashMap<String, Session>>, id: &str) -> u32 {
        let mut child = Command::new("sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id();
        let stdin = child.stdin.take().unwrap();
        sessions.lock().unwrap().insert(
            id.to_string(),
            Session {
                child,
                outbox: spawn_writer(stdin),
            },
        );
        pid
    }

    #[cfg(unix)]
    #[test]
    fn a_server_whose_output_closed_is_removed_and_killed() {
        let sessions = Mutex::new(HashMap::new());
        let pid = sleeping_session(&sessions, "rust:/repo");

        assert!(evict(&sessions, "rust:/repo", pid));

        assert!(sessions.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_late_exit_does_not_remove_a_newer_server_for_the_same_pair() {
        let sessions = Mutex::new(HashMap::new());
        let newer_pid = sleeping_session(&sessions, "rust:/repo");

        // The old server's reader finishing after its replacement started.
        assert!(!evict(&sessions, "rust:/repo", newer_pid + 1));

        assert!(sessions.lock().unwrap().contains_key("rust:/repo"));
        assert!(evict(&sessions, "rust:/repo", newer_pid));
    }

    #[test]
    fn evicting_a_session_that_is_already_gone_does_nothing() {
        let sessions = Mutex::new(HashMap::new());
        assert!(!evict(&sessions, "rust:/repo", 1));
    }
}
