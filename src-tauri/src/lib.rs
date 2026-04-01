pub mod claude;
mod commands;
mod panel;
mod pty;

use claude::ClaudeClient;
use pty::manager::PtyManager;
use std::sync::{Arc, RwLock};
use tauri::Manager;

/// Shared state for the Claude API client, settable at runtime.
pub type ClaudeState = Arc<RwLock<Option<ClaudeClient>>>;

/// Config file path: ~/.forge/config.json
fn config_path() -> std::path::PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".forge")
        .join("config.json")
}

/// Read API key from ~/.forge/config.json
fn read_config_api_key() -> Option<String> {
    let path = config_path();
    let contents = std::fs::read_to_string(&path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&contents).ok()?;
    config.get("api_key")?.as_str().map(|s| s.to_string())
}

/// Write API key to ~/.forge/config.json (preserves other fields)
fn write_config_api_key(key: &str) -> Result<(), String> {
    let path = config_path();
    let _ = std::fs::create_dir_all(path.parent().unwrap());

    let mut config: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    config["api_key"] = serde_json::json!(key);
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| e.to_string())
}

fn build_claude_client(api_key: String) -> ClaudeClient {
    let base_url = std::env::var("ANTHROPIC_BASE_URL")
        .unwrap_or_else(|_| "https://api.anthropic.com/".to_string());
    let base_url = if base_url.ends_with('/') {
        base_url
    } else {
        format!("{}/", base_url)
    };
    let model = std::env::var("ANTHROPIC_DEFAULT_OPUS_MODEL")
        .unwrap_or_else(|_| "claude-opus-4-20250514".to_string());
    ClaudeClient::new(api_key, base_url, model)
}

pub fn run() {
    let pty_manager = PtyManager::new();

    // Initialize Claude client: env vars take precedence, then config file
    let api_key = std::env::var("ANTHROPIC_AUTH_TOKEN")
        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
        .ok()
        .or_else(read_config_api_key);

    let claude_state: ClaudeState = Arc::new(RwLock::new(
        api_key.map(build_claude_client),
    ));

    if claude_state.read().unwrap().is_none() {
        log::warn!("No API key found — summary and flow analysis disabled until configured");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pty_manager)
        .manage(claude_state)
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::panel::get_session_dir,
            commands::panel::get_panel_data,
            commands::panel::refresh_panel,
            commands::panel::git_stage_all,
            commands::panel::git_discard_all,
            commands::panel::get_git_status,
            commands::panel::git_commit,
            commands::panel::git_push,
            commands::panel::set_api_key,
            commands::panel::get_api_status,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let watcher = panel::watcher::start_watcher(handle)
                .expect("Failed to start panel watcher");
            app.manage(watcher);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
