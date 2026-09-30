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
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{AppHandle, Emitter};

use frame::{frame, FrameReader};

/// A message relayed from a server to the frontend.
#[derive(Clone, serde::Serialize)]
pub struct LspMessage {
    /// The session this belongs to — `<language>:<workspace root>`.
    pub id: String,
    /// One JSON-RPC message, no headers.
    pub message: String,
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
fn validate_root(root: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::Path::new(root);
    if !path.is_absolute() {
        return Err(format!("workspace root must be an absolute path: {root}"));
    }
    if !path.is_dir() {
        return Err(format!("workspace root is not a directory: {root}"));
    }
    Ok(path.to_path_buf())
}

/// The session id for a workspace and language. Deriving it rather than handing
/// out a random one means a second editor on the same language reuses the
/// server it already has, which is the expensive thing to start.
fn session_id(language_id: &str, root: &str) -> String {
    format!("{language_id}:{root}")
}

/// Start a server for `language_id` rooted at `root`, or report that there
/// isn't one. Returns the session id to use with `lsp_send`.
///
/// Starting twice for the same pair is a no-op that returns the same id.
#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    manager: tauri::State<'_, LspManager>,
    language_id: String,
    root: String,
) -> Result<String, String> {
    let root_dir = validate_root(&root)?;
    let id = session_id(&language_id, &root);
    {
        let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
        let alive = sessions.get_mut(&id).map(Session::is_alive);
        match alive {
            Some(true) => return Ok(id),
            Some(false) => {
                if let Some(mut dead) = sessions.remove(&id) {
                    let _ = dead.child.wait();
                }
                log::warn!("language server {} had exited; starting a new one", id);
            }
            None => {}
        }
    }

    let spec = server::resolve(&language_id, &root_dir)
        .ok_or_else(|| format!("no language server installed for {language_id}"))?;

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
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", spec.command.display()))?;

    let stdin = child
        .stdin
        .take()
        .ok_or("no stdin on the language server")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("no stdout on the language server")?;
    let stderr = child.stderr.take();

    // Relay stdout. A server writes as it pleases, so the reader owns a
    // `FrameReader` across reads rather than assuming one chunk is one message.
    let emit_id = id.clone();
    let emit_app = app.clone();
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

    manager.sessions.lock().map_err(|e| e.to_string())?.insert(
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
    Ok(id)
}

/// Relay one JSON-RPC message to a running server.
#[tauri::command]
pub fn lsp_send(
    manager: tauri::State<'_, LspManager>,
    id: String,
    message: String,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("no language server session {id}"))?;
    session
        .outbox
        .try_send(frame(&message))
        .map_err(|_| format!("language server {id} is not accepting input"))
}

/// Stop a server. Idempotent, so closing the last editor for a language can
/// call it without checking.
#[tauri::command]
pub fn lsp_stop(manager: tauri::State<'_, LspManager>, id: String) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
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
        assert!(validate_root("repo").is_err());
        assert!(validate_root("").is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_root(dir.path().to_str().unwrap()).is_ok());
        assert!(validate_root(dir.path().join("missing").to_str().unwrap()).is_err());
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
}
