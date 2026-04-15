pub mod analysis;
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

/// Config file path: ~/.atlas/config.json
fn config_path() -> Option<std::path::PathBuf> {
    Some(dirs::home_dir()?.join(".atlas").join("config.json"))
}

/// Read API key from ~/.atlas/config.json
fn read_config_api_key() -> Option<String> {
    let path = config_path()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&contents).ok()?;
    config.get("api_key")?.as_str().map(|s| s.to_string())
}

/// Read a value from ~/.claude/settings.json env block
fn read_claude_settings_env(key: &str) -> Option<String> {
    let path = dirs::home_dir()?.join(".claude").join("settings.json");
    let contents = std::fs::read_to_string(&path).ok()?;
    let settings: serde_json::Value = serde_json::from_str(&contents).ok()?;
    settings.get("env")?.get(key)?.as_str().map(|s| s.to_string())
}

/// Write API key to ~/.atlas/config.json (preserves other fields)
fn write_config_api_key(key: &str) -> Result<(), String> {
    let path = config_path().ok_or("Could not determine home directory")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut config: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    config["api_key"] = serde_json::json!(key);
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(&path, perms);
    }

    Ok(())
}

fn build_claude_client(api_key: String) -> Result<ClaudeClient, String> {
    let base_url = std::env::var("ANTHROPIC_BASE_URL")
        .ok()
        .or_else(|| read_claude_settings_env("ANTHROPIC_BASE_URL"))
        .unwrap_or_else(|| "https://api.anthropic.com/".to_string());
    let base_url = if base_url.ends_with('/') {
        base_url
    } else {
        format!("{}/", base_url)
    };
    let model = std::env::var("ANTHROPIC_MODEL")
        .ok()
        .or_else(|| read_claude_settings_env("ANTHROPIC_MODEL"))
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    log::info!("Claude client: base_url={}, model={}", base_url, model);
    ClaudeClient::new(api_key, base_url, model)
}

/// Install the Atlas notification hook into ~/.claude/settings.json
/// so Claude Code notifies Atlas when it needs input.
fn install_notification_hook(script_path: &str) {
    let claude_settings_path = match dirs::home_dir() {
        Some(h) => h.join(".claude").join("settings.json"),
        None => return,
    };

    // Ensure ~/.claude/ exists
    if let Some(parent) = claude_settings_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut settings: serde_json::Value = std::fs::read_to_string(&claude_settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let Some(hooks) = settings
        .as_object_mut()
        .map(|obj| obj.entry("hooks").or_insert_with(|| serde_json::json!({})))
    else {
        return;
    };

    let Some(notification_hooks) = hooks
        .as_object_mut()
        .map(|obj| obj.entry("Notification").or_insert_with(|| serde_json::json!([])))
    else {
        return;
    };

    // Check if Atlas hook is already installed
    let already_installed = notification_hooks
        .as_array()
        .map(|arr| {
            arr.iter().any(|entry| {
                entry
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|hooks| {
                        hooks.iter().any(|hook| {
                            hook.get("command")
                                .and_then(|c| c.as_str())
                                .map(|c| c.contains("atlas-notify-hook"))
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);

    if already_installed {
        log::info!("Atlas notification hook already installed");
        return;
    }

    // Add the Atlas notification hook
    let hook_entry = serde_json::json!({
        "matcher": "",
        "hooks": [
            {
                "type": "command",
                "command": script_path
            }
        ]
    });

    if let Some(arr) = notification_hooks.as_array_mut() {
        arr.push(hook_entry);
    }

    match serde_json::to_string_pretty(&settings) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&claude_settings_path, json) {
                log::warn!("Failed to write Claude settings: {}", e);
            } else {
                log::info!("Installed Atlas notification hook at {}", script_path);
            }
        }
        Err(e) => log::warn!("Failed to serialize Claude settings: {}", e),
    }
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    let pty_manager = PtyManager::new();

    // Initialize Claude client: env vars > claude settings > atlas config
    let api_key = std::env::var("ANTHROPIC_AUTH_TOKEN")
        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
        .ok()
        .or_else(|| read_claude_settings_env("ANTHROPIC_AUTH_TOKEN"))
        .or_else(read_config_api_key);

    let has_key = api_key.is_some();
    let claude_state: ClaudeState = Arc::new(RwLock::new(
        api_key.and_then(|key| match build_claude_client(key) {
            Ok(client) => Some(client),
            Err(e) => { log::error!("Failed to create Claude client: {}", e); None }
        }),
    ));

    if !has_key {
        log::warn!("No API key found — summary and flow analysis disabled until configured");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
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
            commands::git::git_stage_all,
            commands::git::git_stage_files,
            commands::git::git_discard_all,
            commands::git::get_git_status,
            commands::git::get_child_repos,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_commit,
            commands::git::git_push,
            commands::panel::reset_analysis,
            commands::panel::set_api_key,
            commands::panel::get_api_status,
            commands::git::git_list_branches,
            commands::git::git_checkout_branch,
            commands::git::git_create_branch,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            match panel::watcher::start_watcher(handle) {
                Ok(watcher) => { app.manage(watcher); }
                Err(e) => log::error!("Failed to start panel watcher: {} — panel updates will not work", e),
            }

            // Install notification hook — resolve script path from bundled
            // resources (production) or fall back to the repo scripts/ dir (dev).
            let script_path = app
                .path()
                .resource_dir()
                .ok()
                .map(|r| r.join("atlas-notify-hook.sh"))
                .filter(|p| p.exists())
                .or_else(|| {
                    // Dev mode: script is in the repo's scripts/ directory
                    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .parent()
                        .map(|p| p.join("scripts").join("atlas-notify-hook.sh"))?;
                    if dev_path.exists() { Some(dev_path) } else { None }
                });

            if let Some(path) = script_path {
                install_notification_hook(&path.to_string_lossy());
            } else {
                log::warn!("Could not locate atlas-notify-hook.sh — notification hook not installed");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| log::error!("Tauri application error: {}", e));
}
