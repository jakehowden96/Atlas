use std::collections::HashMap;
use tauri::ipc::Channel;
use tauri::State;

use crate::pty::manager::PtyManager;
use super::panel::cleanup_session_panel;

#[tauri::command]
pub fn pty_spawn(
    manager: State<'_, PtyManager>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env_vars: Option<HashMap<String, String>>,
    on_data: Channel<Vec<u8>>,
) -> Result<u32, String> {
    manager.spawn(cols, rows, cwd, env_vars, on_data)
}

#[tauri::command]
pub fn pty_write(manager: State<'_, PtyManager>, id: u32, data: Vec<u8>) -> Result<(), String> {
    manager.write(id, &data)
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, id: u32, session_id: Option<String>) -> Result<(), String> {
    manager.kill(id)?;
    if let Some(sid) = session_id {
        cleanup_session_panel(&sid);
    }
    Ok(())
}
