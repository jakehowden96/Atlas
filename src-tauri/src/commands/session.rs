use std::time::Duration;

use tauri::State;

use crate::session::live::LiveSession;
use crate::session::manager::LiveSessionManager;
use crate::session::transcript::await_transcript;

/// How long to wait for Claude to create the transcript before giving up.
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
#[tauri::command(async)]
pub async fn start_session_tail(
    session_uuid: String,
    manager: State<'_, LiveSessionManager>,
) -> Result<(), String> {
    let path = await_transcript(&session_uuid, TRANSCRIPT_TIMEOUT)
        .await
        .ok_or_else(|| format!("No transcript found for session {}", session_uuid))?;

    // A resumed session's transcript can be megabytes, so the first read is
    // pushed off the async runtime.
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || manager.start(&session_uuid, path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(())
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
