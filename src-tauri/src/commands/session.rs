use std::ffi::OsStr;
use std::process::Command;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::AtlasError;
use crate::pty::manager::PtyManager;
use crate::session::manager::{LiveSessionManager, SessionUpdateEvent};
use crate::session::omp;
use crate::session::transcript::{find_transcript, is_valid_session_uuid};

fn invalid_session_id(session_uuid: &str) -> AtlasError {
    AtlasError::invalid_input(format!("invalid session id: {session_uuid:?}"))
}

/// Start tailing a session's transcript. Further changes arrive as
/// `session-update` events until `stop_session_tail`.
///
/// The session is registered first, then the transcript is looked for once. A
/// resumed session's file is already there and is attached at once, with its
/// state sent as a `session-update` (nothing will touch the file to trigger
/// one). A new session's file appears only after Claude Code's cold start and
/// first turn, so the watcher attaches it when it does. Registering before
/// looking means a file that appears in between is not missed, and a
/// `stop_session_tail` that lands in between cancels the start instead of
/// leaving a tail behind for a closed tab.
#[tauri::command]
pub async fn start_session_tail(
    session_uuid: String,
    app: AppHandle,
    manager: State<'_, LiveSessionManager>,
) -> Result<(), AtlasError> {
    if !is_valid_session_uuid(&session_uuid) {
        return Err(invalid_session_id(&session_uuid));
    }
    manager.expect(&session_uuid)?;

    let manager = manager.inner().clone();
    let uuid = session_uuid.clone();
    // A resumed session's transcript can be megabytes, so the directory scan
    // and the first read are pushed off the async runtime.
    let session = tokio::task::spawn_blocking(move || {
        let path = find_transcript(&uuid)?;
        manager.start_if_pending(&uuid, path)
    })
    .await?;

    if let Some(session) = session {
        let _ = app.emit(
            "session-update",
            SessionUpdateEvent {
                session_uuid,
                session,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn stop_session_tail(
    session_uuid: String,
    manager: State<'_, LiveSessionManager>,
) -> Result<(), AtlasError> {
    manager.stop(&session_uuid)
}

/// Start tailing an OMP session through its terminal's breadcrumb file.
/// Further changes arrive as `session-update` events until `stop_session_tail`.
///
/// OMP has no transcript uuid to await the way Claude Code does — the tty its
/// shell runs on is the only handle Atlas has, and OMP's own breadcrumb file
/// maps that tty to the transcript path.
#[tauri::command]
pub async fn start_omp_tail(
    session_uuid: String,
    pty_id: u32,
    app: AppHandle,
    manager: State<'_, LiveSessionManager>,
    ptys: State<'_, PtyManager>,
) -> Result<(), AtlasError> {
    if !is_valid_session_uuid(&session_uuid) {
        return Err(invalid_session_id(&session_uuid));
    }
    let tty = ptys
        .tty_name(pty_id)
        .ok_or_else(|| AtlasError::not_found(format!("no tty for pty {pty_id}")))?;
    let agent_dir = omp::agent_dir()
        .ok_or_else(|| AtlasError::internal("could not determine home directory"))?;
    let breadcrumb = omp::breadcrumb_path(&agent_dir, &tty);
    let since = SystemTime::now() - Duration::from_secs(2);

    let manager = manager.inner().clone();
    let uuid = session_uuid.clone();
    let session =
        tokio::task::spawn_blocking(move || manager.watch_omp(&uuid, breadcrumb, since)).await?;

    if let Some(session) = session {
        let _ = app.emit(
            "session-update",
            SessionUpdateEvent {
                session_uuid,
                session,
            },
        );
    }
    Ok(())
}

/// What Settings › Claude Code reports. Every field degrades to `None`/`false`
/// rather than erroring: the section is diagnostic, not load-bearing.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInfo {
    /// Absolute path to the `claude` binary, if it is on PATH.
    pub binary: Option<String>,
    /// First line of `claude --version`, trimmed.
    pub version: Option<String>,
    /// Whether Atlas's `hook notification` entry is in `~/.claude/settings.json`.
    pub notification_hook_installed: bool,
    /// Whether Atlas's `hook session-start` entry is in `~/.claude/settings.json`.
    pub session_start_hook_installed: bool,
}

/// A command for a diagnostic probe. On Windows a GUI-subsystem app that spawns
/// a console program would flash a console window each time, so it is created
/// without one. [UNVERIFIED on Windows]
fn probe(program: impl AsRef<OsStr>) -> Command {
    // `mut` is only needed on Windows, where the creation flag is set.
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// First non-empty line a probe printed, when it succeeded.
fn first_line(mut command: Command) -> Option<String> {
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn which_claude() -> Option<String> {
    #[cfg(target_os = "windows")]
    let lookup = "where";
    #[cfg(not(target_os = "windows"))]
    let lookup = "which";

    let mut command = probe(lookup);
    command.arg("claude");
    // `where` can print several matches; the first is the one that would run.
    first_line(command)
}

/// Asked of the path `which_claude` found rather than of the bare name, so an
/// npm-installed `claude.cmd` shim, which `where` finds but a bare
/// `Command::new("claude")` does not, still reports its version.
/// [UNVERIFIED on Windows]
fn claude_version(binary: &str) -> Option<String> {
    let mut command = probe(binary);
    command.arg("--version");
    first_line(command)
}

#[tauri::command]
pub async fn claude_info() -> Result<ClaudeInfo, AtlasError> {
    Ok(tokio::task::spawn_blocking(|| {
        let binary = which_claude();
        let version = binary.as_deref().and_then(claude_version);
        ClaudeInfo {
            binary,
            version,
            notification_hook_installed: crate::claude_hook::notification_installed(),
            session_start_hook_installed: crate::claude_hook::session_start_installed(),
        }
    })
    .await?)
}
