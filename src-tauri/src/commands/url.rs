use super::proc::no_window;
use crate::error::AtlasError;
use std::process::Command;

/// The platform's "open this in the default handler" launcher.
/// Tauri 2 doesn't ship the opener plugin in this project, so we shell out.
pub(crate) fn browser_launcher(url: &str) -> Command {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // Not `cmd /C start`: cmd re-parses its command line, so a `&` or `|`
        // in the URL would escape the argument quoting.
        let mut cmd = Command::new("rundll32");
        cmd.args(["url.dll,FileProtocolHandler", url]);
        cmd
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    };
    no_window(&mut cmd);
    cmd
}

/// The scheme check is the guard against launching arbitrary handlers: only
/// `https://` URLs may be opened.
fn check_open_url(url: &str) -> Result<(), AtlasError> {
    if !url.starts_with("https://") {
        return Err(AtlasError::invalid_input("Only https:// URLs are allowed"));
    }
    Ok(())
}

/// Open an external URL in the user's default browser.
#[tauri::command(async)]
pub async fn open_url(url: String) -> Result<(), AtlasError> {
    check_open_url(&url)?;
    tokio::task::spawn_blocking(move || {
        let mut launcher = browser_launcher(&url);
        let tool = launcher.get_program().to_string_lossy().into_owned();
        let status = launcher
            .status()
            .map_err(|e| AtlasError::tool_failed(&tool, format!("Failed to open URL: {e}")))?;
        if status.success() {
            Ok(())
        } else {
            Err(AtlasError::tool_failed(
                &tool,
                format!("URL launcher exited with status {status}"),
            ))
        }
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_url_accepts_https_with_a_query_string() {
        assert!(check_open_url("https://example.com/?a=1&b=2").is_ok());
    }

    #[test]
    fn open_url_rejects_non_https_schemes() {
        assert!(check_open_url("file:///etc/passwd").is_err());
        assert!(check_open_url("http://example.com").is_err());
        assert!(check_open_url("calculator").is_err());
    }
}
