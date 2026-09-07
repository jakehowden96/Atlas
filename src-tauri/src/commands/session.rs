use std::time::Duration;

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
