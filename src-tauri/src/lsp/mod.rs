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
    stdin: std::process::ChildStdin,
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
    let id = session_id(&language_id, &root);
    {
        let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&id) {
            return Ok(id);
        }
    }

    let spec = server::resolve(&language_id, std::path::Path::new(&root))
        .ok_or_else(|| format!("no language server installed for {language_id}"))?;

    let mut child = Command::new(&spec.command)
        .args(&spec.args)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", spec.command.display()))?;

    let stdin = child.stdin.take().ok_or("no stdin on the language server")?;
    let stdout = child.stdout.take().ok_or("no stdout on the language server")?;
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
                            LspMessage { id: emit_id.clone(), message },
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
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::warn!("[lsp {}] {}", log_id, line);
            }
        });
    }

    manager
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), Session { child, stdin });
    log::info!("started language server {} ({})", id, spec.command.display());
    Ok(id)
}

/// Relay one JSON-RPC message to a running server.
#[tauri::command]
pub fn lsp_send(
    manager: tauri::State<'_, LspManager>,
    id: String,
    message: String,
) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("no language server session {id}"))?;
    session
        .stdin
        .write_all(&frame(&message))
        .and_then(|_| session.stdin.flush())
        .map_err(|e| format!("language server {id} is not accepting input: {e}"))
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
        assert_eq!(session_id("typescript", "/a"), session_id("typescript", "/a"));
        assert_ne!(session_id("typescript", "/a"), session_id("typescript", "/b"));
        assert_ne!(session_id("typescript", "/a"), session_id("javascript", "/a"));
    }
}
