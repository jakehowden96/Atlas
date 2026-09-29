use std::process::Command;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::pty::manager::PtyManager;
use crate::session::manager::{LiveSessionManager, SessionUpdateEvent};
use crate::session::omp;
use crate::session::transcript::await_transcript;

/// How long `start_session_tail` waits for a transcript that already exists
/// (the resume case) before handing the session to the watcher instead.
const TRANSCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

/// Start tailing a session's transcript. Further changes arrive as
/// `session-update` events until `stop_session_tail`.
///
/// The transcript usually does not exist yet: this is called right after the
/// spawn, and Claude Code writes the file only after its cold start and first
/// turn — comfortably longer than any timeout worth blocking a command on.
/// So when the file is not there, the session is registered as pending and the
/// watcher attaches the tail when it appears. Returning an error instead would
/// abandon the session forever, which is what used to happen.
#[tauri::command(async)]
pub async fn start_session_tail(
    session_uuid: String,
    manager: State<'_, LiveSessionManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();

    match await_transcript(&session_uuid, TRANSCRIPT_TIMEOUT).await {
        Some(path) => {
            // A resumed session's transcript can be megabytes, so the first read
            // is pushed off the async runtime.
            let uuid = session_uuid.clone();
            tokio::task::spawn_blocking(move || manager.start(&uuid, path))
                .await
                .map_err(|e| e.to_string())??;
            Ok(())
        }
        None => manager.expect(&session_uuid),
    }
}

#[tauri::command]
pub fn stop_session_tail(
    session_uuid: String,
    manager: State<'_, LiveSessionManager>,
) -> Result<(), String> {
    manager.stop(&session_uuid)
}

/// Start tailing an OMP session through its terminal's breadcrumb file.
/// Further changes arrive as `session-update` events until `stop_session_tail`.
///
/// OMP has no transcript uuid to await the way Claude Code does — the tty its
/// shell runs on is the only handle Atlas has, and OMP's own breadcrumb file
/// maps that tty to the transcript path.
#[tauri::command(async)]
pub async fn start_omp_tail(
    session_uuid: String,
    pty_id: u32,
    app: AppHandle,
    manager: State<'_, LiveSessionManager>,
    ptys: State<'_, PtyManager>,
) -> Result<(), String> {
    let tty = ptys.tty_name(pty_id).ok_or_else(|| format!("no tty for pty {pty_id}"))?;
    let agent_dir = omp::agent_dir().ok_or_else(|| "could not determine home directory".to_string())?;
    let breadcrumb = omp::breadcrumb_path(&agent_dir, &tty);
    let since = SystemTime::now() - Duration::from_secs(2);

    let manager = manager.inner().clone();
    let uuid = session_uuid.clone();
    let session = tokio::task::spawn_blocking(move || manager.watch_omp(&uuid, breadcrumb, since))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(session) = session {
        let _ = app.emit("session-update", SessionUpdateEvent { session_uuid, session });
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

fn which_claude() -> Option<String> {
    #[cfg(target_os = "windows")]
    let (prog, args) = ("where", ["claude"]);
    #[cfg(not(target_os = "windows"))]
    let (prog, args) = ("which", ["claude"]);

    let output = Command::new(prog).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    // `where` can print several matches; the first is the one that would run.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn claude_version() -> Option<String> {
    let output = Command::new("claude").arg("--version").output().ok()?;
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

/// True when any command under `hooks[event]` carries `marker`.
fn hook_installed(event: &str, marker: &str) -> bool {
    let Some(path) = dirs::home_dir().map(|h| h.join(".claude").join("settings.json")) else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    settings["hooks"][event].as_array().is_some_and(|entries| {
        entries.iter().any(|entry| {
            entry["hooks"].as_array().is_some_and(|inner| {
                inner.iter().any(|hook| {
                    hook.get("command")
                        .and_then(|c| c.as_str())
                        .is_some_and(|c| c.contains(marker))
                })
            })
        })
    })
}

fn notification_hook_installed() -> bool {
    hook_installed("Notification", crate::HOOK_MARKER)
}

fn session_start_hook_installed() -> bool {
    hook_installed("SessionStart", crate::SESSION_START_HOOK_MARKER)
}

#[tauri::command(async)]
pub async fn claude_info() -> Result<ClaudeInfo, String> {
    tokio::task::spawn_blocking(|| ClaudeInfo {
        binary: which_claude(),
        version: claude_version(),
        notification_hook_installed: notification_hook_installed(),
        session_start_hook_installed: session_start_hook_installed(),
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Diagnostic only — it must resolve whether or not `claude` is installed
    /// on the machine running the suite.
    #[tokio::test]
    async fn claude_info_never_errors() {
        let info = claude_info().await.expect("claude_info must never error");
        if let Some(binary) = &info.binary {
            assert!(!binary.is_empty());
        }
        if let Some(version) = &info.version {
            assert!(!version.is_empty());
        }
    }
}
