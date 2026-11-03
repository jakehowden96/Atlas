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
    reveal(&dir)
}

/// Show a file or folder in the OS file manager, selected where the platform allows.
#[tauri::command(async)]
pub fn reveal_path(path: String) -> Result<(), AtlasError> {
    if path.trim().is_empty() {
        return Err(AtlasError::invalid_input("Path is empty"));
    }
    let path = std::path::PathBuf::from(path);
    if !path.exists() {
        return Err(AtlasError::not_found(format!(
            "{} does not exist",
            path.display()
        )));
    }
    reveal(&path)
}

/// Program and arguments that reveal an existing `path`.
fn reveal_args(path: &std::path::Path) -> (&'static str, Vec<std::ffi::OsString>) {
    #[cfg(target_os = "windows")]
    {
        // explorer ignores forward slashes in /select, and takes a single argument.
        let p = path.to_string_lossy().replace('/', "\\");
        ("explorer", vec![format!("/select,{p}").into()])
    }
    #[cfg(target_os = "macos")]
    {
        ("open", vec!["-R".into(), path.into()])
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let dir = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        ("xdg-open", vec![dir.into()])
    }
}

fn reveal(path: &std::path::Path) -> Result<(), AtlasError> {
    let (tool, args) = reveal_args(path);
    let mut cmd = std::process::Command::new(tool);
    cmd.args(args);
    super::proc::no_window(&mut cmd);
    let status = cmd
        .status()
        .map_err(|e| AtlasError::tool_failed(tool, format!("Failed to reveal path: {e}")))?;
    // explorer.exe exits 1 even when it succeeds.
    if status.success() || cfg!(target_os = "windows") {
        Ok(())
    } else {
        Err(AtlasError::tool_failed(
            tool,
            format!("exited with status {status}"),
        ))
    }
}

#[cfg(test)]
mod reveal_tests {
    use super::*;

    #[test]
    fn rejects_empty_and_missing() {
        assert!(matches!(
            reveal_path(" ".into()),
            Err(AtlasError::InvalidInput { .. })
        ));
        assert!(matches!(
            reveal_path("/definitely/not/here/xyz".into()),
            Err(AtlasError::NotFound { .. })
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_selects_with_backslashes() {
        let (tool, args) = reveal_args(std::path::Path::new("C:/a/b.md"));
        assert_eq!(tool, "explorer");
        assert_eq!(args, vec![std::ffi::OsString::from("/select,C:\\a\\b.md")]);
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
