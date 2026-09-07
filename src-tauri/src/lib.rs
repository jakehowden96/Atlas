mod commands;
pub mod hook;
mod panel;
mod pty;

use pty::manager::PtyManager;
use tauri::{Emitter, Manager};

fn setup_logging() {
    let log_dir = dirs::home_dir()
        .map(|h| h.join(".atlas").join("logs"))
        .expect("could not resolve home directory");

    std::fs::create_dir_all(&log_dir).ok();

    let file_config = fern::DateBased::new(
        log_dir.join("atlas-backend-"),
        "%Y-%m-%d.log",
    );

    fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{}] [{}] [{}] {}",
                chrono::Local::now().format("%H:%M:%S%.3f"),
                record.level(),
                record.target(),
                message
            ))
        })
        .level(log::LevelFilter::Info)
        .chain(std::io::stderr())
        .chain(file_config)
        .apply()
        .ok();

    clean_old_logs(&log_dir, 7);
}

fn clean_old_logs(log_dir: &std::path::Path, max_age_days: u64) {
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);
    let Ok(entries) = std::fs::read_dir(log_dir) else { return };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().ends_with(".log") { continue; }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

/// Identifies Atlas's own entry in `hooks.Notification`. The command is
/// `"<exe>" hook notification`, so the argv tail is the part that is stable
/// across install locations and platforms.
const HOOK_MARKER: &str = "hook notification";

/// The now-deleted `scripts/atlas-notify-hook.sh` entry, removed on upgrade so
/// users do not end up running both.
const LEGACY_HOOK_MARKER: &str = "atlas-notify-hook";

/// `"<exe>" hook notification` — quoted because the path contains spaces on
/// both Windows (`C:\Program Files\...`) and macOS (`/Applications/Atlas.app/...`).
fn notification_hook_command() -> Result<String, std::io::Error> {
    Ok(format!(
        "\"{}\" hook notification",
        std::env::current_exe()?.display()
    ))
}

fn hook_command_str(hook: &serde_json::Value) -> &str {
    hook.get("command").and_then(|c| c.as_str()).unwrap_or("")
}

/// Merge Atlas's notification hook into a parsed `settings.json`, dropping any
/// stale shell-script entry. Returns true when `settings` was modified.
fn merge_notification_hook(settings: &mut serde_json::Value, command: &str) -> bool {
    let Some(root) = settings.as_object_mut() else {
        return false;
    };
    let hooks = root.entry("hooks").or_insert_with(|| serde_json::json!({}));
    let Some(hooks_obj) = hooks.as_object_mut() else {
        return false;
    };
    let notification = hooks_obj
        .entry("Notification")
        .or_insert_with(|| serde_json::json!([]));
    let Some(entries) = notification.as_array_mut() else {
        return false;
    };

    let mut changed = false;

    entries.retain_mut(|entry| {
        let Some(inner) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
            return true;
        };
        let before = inner.len();
        inner.retain(|hook| !hook_command_str(hook).contains(LEGACY_HOOK_MARKER));
        if inner.len() == before {
            return true;
        }
        changed = true;
        // Drop the wrapper too if the legacy command was all it held.
        !inner.is_empty()
    });

    let already_installed = entries.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .is_some_and(|inner| {
                inner
                    .iter()
                    .any(|hook| hook_command_str(hook).contains(HOOK_MARKER))
            })
    });

    if !already_installed {
        entries.push(serde_json::json!({
            "matcher": "",
            "hooks": [{ "type": "command", "command": command }]
        }));
        changed = true;
    }

    changed
}

/// Install the Atlas notification hook into ~/.claude/settings.json
/// so Claude Code notifies Atlas when it needs input.
fn install_notification_hook(command: &str) {
    let claude_settings_path = match dirs::home_dir() {
        Some(h) => h.join(".claude").join("settings.json"),
        None => return,
    };

    if let Some(parent) = claude_settings_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut settings: serde_json::Value = std::fs::read_to_string(&claude_settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !merge_notification_hook(&mut settings, command) {
        log::info!("Atlas notification hook already installed");
        return;
    }

    match serde_json::to_string_pretty(&settings) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&claude_settings_path, json) {
                log::warn!("Failed to write Claude settings: {}", e);
            } else {
                log::info!("Installed Atlas notification hook: {}", command);
            }
        }
        Err(e) => log::warn!("Failed to serialize Claude settings: {}", e),
    }
}

/// macOS GUI apps inherit launchd's bare PATH (/usr/bin:/bin:...), which lacks
/// Homebrew's bin dir — so direct `Command::new("gh")` spawns fail when Atlas
/// is launched from Finder/Dock rather than a terminal. Append the standard
/// Homebrew locations (Apple Silicon and Intel) if they're missing.
fn extend_path_for_gui_launch() {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<std::path::PathBuf> = std::env::split_paths(&current).collect();
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let dir = std::path::Path::new(dir);
        if dir.is_dir() && !parts.iter().any(|p| p == dir) {
            parts.push(dir.to_path_buf());
        }
    }
    if let Ok(joined) = std::env::join_paths(parts) {
        std::env::set_var("PATH", joined);
    }
}

pub fn run() {
    setup_logging();
    extend_path_for_gui_launch();

    let pty_manager = PtyManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(pty_manager)
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
            commands::git::git_list_branches,
            commands::git::git_checkout_branch,
            commands::git::git_create_branch,
            commands::prs::list_repo_prs,
            commands::prs::open_url,
            commands::stats::get_claude_stats,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            match panel::watcher::start_watcher(handle) {
                Ok(watcher) => { app.manage(watcher); }
                Err(e) => log::error!("Failed to start panel watcher: {} — panel updates will not work", e),
            }

            let stats_handle = app.handle().clone();
            match commands::stats::start_stats_watcher(stats_handle) {
                Ok(watcher) => { app.manage(watcher); }
                Err(e) => log::warn!("Failed to start stats watcher: {} — live stats updates will not work", e),
            }

            // Back-fill stats from all historical transcripts on launch (off the UI thread).
            let launch_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match tokio::task::spawn_blocking(commands::stats::recompute).await {
                    Ok(Ok(summary)) => {
                        let _ = launch_handle.emit("stats-update", &summary);
                    }
                    Ok(Err(e)) => log::warn!("Initial stats recompute failed: {}", e),
                    Err(e) => log::warn!("Initial stats recompute task failed: {}", e),
                }
            });

            // Install the notification hook, pointing at this executable —
            // `current_exe()` resolves in both dev and bundled builds.
            match notification_hook_command() {
                Ok(command) => install_notification_hook(&command),
                Err(e) => log::warn!(
                    "Could not resolve the Atlas executable — notification hook not installed: {}",
                    e
                ),
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| log::error!("Tauri application error: {}", e));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `command` string under `hooks.Notification`, flattened.
    fn commands(settings: &serde_json::Value) -> Vec<String> {
        settings["hooks"]["Notification"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|entry| entry["hooks"].as_array().unwrap())
            .map(|hook| hook["command"].as_str().unwrap().to_string())
            .collect()
    }

    const NEW: &str = "\"C:\\Program Files\\Atlas\\Atlas.exe\" hook notification";

    #[test]
    fn installs_into_empty_settings() {
        let mut settings = serde_json::json!({});
        assert!(merge_notification_hook(&mut settings, NEW));
        assert_eq!(commands(&settings), vec![NEW]);
        assert_eq!(settings["hooks"]["Notification"][0]["matcher"], "");
        assert_eq!(
            settings["hooks"]["Notification"][0]["hooks"][0]["type"],
            "command"
        );
    }

    #[test]
    fn second_install_is_a_no_op() {
        let mut settings = serde_json::json!({});
        assert!(merge_notification_hook(&mut settings, NEW));
        assert!(!merge_notification_hook(&mut settings, NEW));
        assert_eq!(commands(&settings), vec![NEW]);
    }

    #[test]
    fn replaces_the_legacy_shell_hook() {
        let mut settings = serde_json::json!({
            "hooks": {
                "Notification": [{
                    "matcher": "",
                    "hooks": [{ "type": "command", "command": "/repo/scripts/atlas-notify-hook.sh" }]
                }]
            }
        });
        assert!(merge_notification_hook(&mut settings, NEW));
        assert_eq!(commands(&settings), vec![NEW]);
    }

    #[test]
    fn keeps_other_hooks_and_other_keys() {
        let mut settings = serde_json::json!({
            "model": "opus",
            "hooks": {
                "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "other-stop" }] }],
                "Notification": [{
                    "matcher": "",
                    "hooks": [
                        { "type": "command", "command": "someone-elses-hook" },
                        { "type": "command", "command": "/repo/scripts/atlas-notify-hook.sh" }
                    ]
                }]
            }
        });
        assert!(merge_notification_hook(&mut settings, NEW));
        assert_eq!(
            commands(&settings),
            vec!["someone-elses-hook".to_string(), NEW.to_string()]
        );
        assert_eq!(settings["model"], "opus");
        assert_eq!(
            settings["hooks"]["Stop"][0]["hooks"][0]["command"],
            "other-stop"
        );
    }

    #[test]
    fn quotes_the_executable_path() {
        let command = notification_hook_command().unwrap();
        assert!(command.starts_with('"'));
        assert!(command.ends_with("\" hook notification"));
        assert!(command.contains(HOOK_MARKER));
    }
}
