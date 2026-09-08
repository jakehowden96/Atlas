use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::session::live::LiveSession;
use crate::session::manager::LiveSessionManager;
use crate::session::transcript::await_transcript;

/// How long `get_session_transcript_path` waits for a transcript to appear.
/// `start_session_tail` uses it only as a fast path for a file that already
/// exists (a resume); a fresh session falls through to the watcher instead.
const TRANSCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

/// Resolve the `~/.claude/projects/*/<uuid>.jsonl` transcript for a session
/// Atlas started with `claude --session-id <uuid>`. Returns `None` if the file
/// has not appeared within `TRANSCRIPT_TIMEOUT`, or the uuid is malformed.
#[tauri::command(async)]
pub async fn get_session_transcript_path(session_uuid: String) -> Result<Option<String>, String> {
    Ok(await_transcript(&session_uuid, TRANSCRIPT_TIMEOUT)
        .await
        .map(|p| p.to_string_lossy().into_owned()))
}

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

#[tauri::command]
pub fn get_live_session(
    session_uuid: String,
    manager: State<'_, LiveSessionManager>,
) -> Result<Option<LiveSession>, String> {
    manager.get(&session_uuid)
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

/// True when any command under `hooks.Notification` carries Atlas's marker.
fn notification_hook_installed() -> bool {
    let Some(path) = dirs::home_dir().map(|h| h.join(".claude").join("settings.json")) else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    settings["hooks"]["Notification"]
        .as_array()
        .is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry["hooks"].as_array().is_some_and(|inner| {
                    inner.iter().any(|hook| {
                        hook.get("command")
                            .and_then(|c| c.as_str())
                            .is_some_and(|c| c.contains(crate::HOOK_MARKER))
                    })
                })
            })
        })
}

#[tauri::command(async)]
pub async fn claude_info() -> Result<ClaudeInfo, String> {
    tokio::task::spawn_blocking(|| ClaudeInfo {
        binary: which_claude(),
        version: claude_version(),
        notification_hook_installed: notification_hook_installed(),
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
