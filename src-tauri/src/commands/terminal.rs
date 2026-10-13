use std::collections::HashMap;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::panel::cleanup_session_analysis;
use crate::error::AtlasError;
use crate::pty::manager::PtyManager;

#[tauri::command(async)]
pub fn pty_spawn(
    manager: State<'_, PtyManager>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env_vars: Option<HashMap<String, String>>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<u32, AtlasError> {
    manager.spawn(cols, rows, cwd, env_vars, on_data)
}

/// Deliberately a plain (main-thread) command: it only queues the bytes, so it
/// cannot block, and the main thread is what runs one window's commands in the
/// order they were sent. An `async` command would be scheduled onto the
/// runtime's threads and two keystrokes could overtake each other.
#[tauri::command]
pub fn pty_write(manager: State<'_, PtyManager>, id: u32, data: Vec<u8>) -> Result<(), AtlasError> {
    manager.write(id, data)
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), AtlasError> {
    manager.resize(id, cols, rows)
}

#[tauri::command(async)]
pub fn pty_kill(
    manager: State<'_, PtyManager>,
    id: u32,
    session_id: Option<String>,
) -> Result<(), AtlasError> {
    manager.kill(id)?;
    if let Some(sid) = session_id {
        cleanup_session_analysis(&sid);
    }
    Ok(())
}
