pub mod claude;
mod commands;
mod panel;
mod pty;

use claude::ClaudeClient;
use pty::manager::PtyManager;
use tauri::Manager;

pub fn run() {
    let pty_manager = PtyManager::new();

    // Initialize Claude client from environment
    // Supports ANTHROPIC_AUTH_TOKEN (LiteLLM) or ANTHROPIC_API_KEY
    let api_key = std::env::var("ANTHROPIC_AUTH_TOKEN")
        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"));
    let claude_client = match api_key {
        Ok(key) => {
            let base_url = std::env::var("ANTHROPIC_BASE_URL")
                .unwrap_or_else(|_| "https://api.anthropic.com/".to_string());
            // Ensure trailing slash
            let base_url = if base_url.ends_with('/') {
                base_url
            } else {
                format!("{}/", base_url)
            };
            let model = std::env::var("ANTHROPIC_DEFAULT_OPUS_MODEL")
                .unwrap_or_else(|_| "claude-opus-4-20250514".to_string());
            Some(ClaudeClient::new(key, base_url, model))
        }
        Err(_) => {
            log::warn!("No API key found (ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY) — summary and flow analysis disabled");
            None
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(pty_manager)
        .manage(claude_client)
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::panel::get_session_dir,
            commands::panel::get_panel_data,
            commands::panel::refresh_panel,
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
