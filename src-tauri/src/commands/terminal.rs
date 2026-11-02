use std::collections::HashMap;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::panel::cleanup_session_analysis;
use crate::error::AtlasError;
use crate::pty::manager::PtyManager;

/// Where the backend logs go (`~/.atlas/logs`), for "Copy path".
#[tauri::command]
pub fn logs_dir() -> Result<String, AtlasError> {
    crate::logs_dir()
        .map(|d| d.display().to_string())
        .ok_or_else(|| AtlasError::internal("Could not resolve the home directory"))
}

/// Open the log directory in the OS file manager.
#[tauri::command(async)]
pub fn reveal_logs_dir() -> Result<(), AtlasError> {
    let dir = crate::logs_dir()
        .ok_or_else(|| AtlasError::internal("Could not resolve the home directory"))?;
    std::fs::create_dir_all(&dir).map_err(|e| AtlasError::io_at(&dir, &e))?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut cmd = std::process::Command::new("rundll32");
        cmd.arg("url.dll,FileProtocolHandler");
        cmd
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&dir);
    super::proc::no_window(&mut cmd);
    let tool = cmd.get_program().to_string_lossy().into_owned();
    let status = cmd
        .status()
        .map_err(|e| AtlasError::tool_failed(&tool, format!("Failed to open logs: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(AtlasError::tool_failed(
            &tool,
            format!("exited with status {status}"),
        ))
    }
}

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
