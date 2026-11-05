use std::ffi::OsStr;
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::claude_hook::HookStatus;
use crate::error::AtlasError;
use crate::session::manager::{LiveSessionManager, SessionUpdateEvent};
use crate::session::transcript::{find_transcript, is_valid_session_uuid};
use crate::state::{StateFile, StateStore};
use ts_rs::TS;

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

/// What Settings › Claude Code reports. Every field degrades to `None`/`false`
/// rather than erroring: the section is diagnostic, not load-bearing.
#[derive(Debug, Serialize, Default, TS)]
#[ts(export)]
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
    /// Installed and up to date, installed but stale, or not installed.
    pub notification_hook: HookStatus,
    pub session_start_hook: HookStatus,
}

/// A command for a diagnostic probe. On Windows a GUI-subsystem app that spawns
/// a console program would flash a console window each time, so it is created
/// without one. [UNVERIFIED on Windows]
pub(crate) fn probe(program: impl AsRef<OsStr>) -> Command {
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
pub(crate) fn first_line(mut command: Command) -> Option<String> {
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

fn info_for(binary: Option<String>) -> ClaudeInfo {
    let version = binary.as_deref().and_then(claude_version);
    ClaudeInfo {
        binary,
        version,
        notification_hook_installed: crate::claude_hook::notification_installed(),
        session_start_hook_installed: crate::claude_hook::session_start_installed(),
        notification_hook: crate::claude_hook::notification_status(),
        session_start_hook: crate::claude_hook::session_start_status(),
    }
}

/// The user's `claudeBinaryPath` setting, when set to a non-blank string and
/// pointing at a file; otherwise `None` and PATH lookup applies.
fn override_binary(settings: Option<&serde_json::Value>) -> Option<String> {
    let path = settings?.get("claudeBinaryPath")?.as_str()?.trim();
    (!path.is_empty() && std::path::Path::new(path).is_file()).then(|| path.to_string())
}

#[tauri::command]
pub async fn claude_info(state: State<'_, StateStore>) -> Result<ClaudeInfo, AtlasError> {
    let settings = state.read_json(StateFile::Settings);
    Ok(tokio::task::spawn_blocking(move || {
        info_for(override_binary(settings.as_ref()).or_else(which_claude))
    })
    .await?)
}

const VERSION_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Run `<path> --version` without a session, killing it after `timeout`. A
/// failure is typed: not a file, did not start, timed out, exited non-zero.
fn probe_version(path: &str, timeout: std::time::Duration) -> Result<String, AtlasError> {
    if !std::path::Path::new(path).is_file() {
        return Err(AtlasError::tool_missing(
            "claude",
            format!("{path} is not a file"),
        ));
    }
    let mut command = probe(path);
    command
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|e| AtlasError::tool_failed("claude", format!("could not start {path}: {e}")))?;
    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(AtlasError::io)? {
            Some(status) => break status,
            None if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AtlasError::timeout(
                    "claude",
                    format!("{path} --version did not finish in {}s", timeout.as_secs()),
                ));
            }
            None => std::thread::sleep(std::time::Duration::from_millis(25)),
        }
    };
    if !status.success() {
        return Err(AtlasError::tool_failed(
            "claude",
            format!("{path} --version exited with {status}"),
        ));
    }
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        std::io::Read::read_to_string(&mut stdout, &mut out).map_err(AtlasError::io)?;
    }
    out.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AtlasError::tool_failed("claude", format!("{path} printed no version")))
}

/// Validate a binary the user picked: probe `<path> --version` without
/// spawning a session. `None` checks what `claude_info` would use now.
#[tauri::command]
pub async fn claude_check(
    path: Option<String>,
    state: State<'_, StateStore>,
) -> Result<ClaudeInfo, AtlasError> {
    let Some(path) = path else {
        return claude_info(state).await;
    };
    tokio::task::spawn_blocking(move || {
        let version = probe_version(&path, VERSION_PROBE_TIMEOUT)?;
        Ok(ClaudeInfo {
            version: Some(version),
            binary: Some(path),
            ..info_for(None)
        })
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bogus_path_is_a_typed_failure() {
        let err = probe_version("/definitely/not/a/claude", VERSION_PROBE_TIMEOUT).unwrap_err();
        assert!(matches!(err, AtlasError::ToolMissing { .. }), "{err:?}");
    }

    #[test]
    fn override_needs_a_non_blank_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("claude");
        std::fs::write(&file, "").unwrap();
        let set = |p: &str| serde_json::json!({ "claudeBinaryPath": p });
        assert_eq!(
            override_binary(Some(&set(file.to_str().unwrap()))),
            Some(file.to_str().unwrap().to_string())
        );
        assert_eq!(override_binary(Some(&set("  "))), None);
        assert_eq!(override_binary(Some(&set("/nope/claude"))), None);
        assert_eq!(override_binary(Some(&serde_json::json!({}))), None);
        assert_eq!(override_binary(None), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_hanging_binary_times_out() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("claude");
        std::fs::write(&file, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = probe_version(
            file.to_str().unwrap(),
            std::time::Duration::from_millis(200),
        )
        .unwrap_err();
        assert!(matches!(err, AtlasError::Timeout { .. }), "{err:?}");
    }
}
