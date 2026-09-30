mod atomic_write;
mod commands;
pub mod hook;
mod lsp;
mod panel;
mod pty;
mod session;
mod transcript;

use pty::manager::PtyManager;
use session::manager::LiveSessionManager;
use tauri::menu::{Menu, MenuItemBuilder, WINDOW_SUBMENU_ID};
use tauri::{Emitter, Manager};

const BACK_TO_SESSIONS_MENU_ID: &str = "back-to-sessions";

fn setup_logging() {
    let log_dir = dirs::home_dir()
        .map(|h| h.join(".atlas").join("logs"))
        .expect("could not resolve home directory");

    std::fs::create_dir_all(&log_dir).ok();

    let file_config = fern::DateBased::new(log_dir.join("atlas-backend-"), "%Y-%m-%d.log");

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
    let cutoff =
        std::time::SystemTime::now() - std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().ends_with(".log") {
            continue;
        }
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
pub(crate) const HOOK_MARKER: &str = "hook notification";

/// Identifies Atlas's own entry in `hooks.SessionStart`, the same way.
pub(crate) const SESSION_START_HOOK_MARKER: &str = "hook session-start";

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

/// `"<exe>" hook session-start`, quoted the same way.
fn session_start_hook_command() -> Result<String, std::io::Error> {
    Ok(format!(
        "\"{}\" hook session-start",
        std::env::current_exe()?.display()
    ))
}

fn hook_command_str(hook: &serde_json::Value) -> &str {
    hook.get("command").and_then(|c| c.as_str()).unwrap_or("")
}

/// True when `command` has the exact shape Atlas installs: a quoted executable
/// path followed by `marker` as the whole argv tail. A user's own hook that
/// merely mentions the marker somewhere does not qualify.
fn is_atlas_command(command: &str, marker: &str) -> bool {
    let command = command.trim();
    command.starts_with('"') && command.ends_with(&format!("\" {marker}"))
}

/// Make `settings["hooks"][event]` carry exactly one Atlas entry whose command
/// is `command`. An Atlas entry left by another install location (the app
/// moved, a dev build ran first) is rewritten in place, and further stale
/// duplicates are dropped; user hooks are never touched. Returns true when
/// `settings` was modified. Shared by every hook Atlas installs.
///
/// When a dev build and an installed build coexist, whichever launched last
/// owns the entry.
fn merge_hook(settings: &mut serde_json::Value, event: &str, marker: &str, command: &str) -> bool {
    let Some(root) = settings.as_object_mut() else {
        return false;
    };
    let hooks = root.entry("hooks").or_insert_with(|| serde_json::json!({}));
    let Some(hooks_obj) = hooks.as_object_mut() else {
        return false;
    };
    let entry_list = hooks_obj
        .entry(event)
        .or_insert_with(|| serde_json::json!([]));
    let Some(entries) = entry_list.as_array_mut() else {
        return false;
    };

    let mut current_seen = entries.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .is_some_and(|inner| inner.iter().any(|hook| hook_command_str(hook) == command))
    });
    let mut changed = false;
    entries.retain_mut(|entry| {
        let Some(inner) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
            return true;
        };
        let before = inner.len();
        inner.retain_mut(|hook| {
            let existing = hook_command_str(hook);
            if existing == command || !is_atlas_command(existing, marker) {
                return true;
            }
            changed = true;
            if current_seen {
                return false;
            }
            current_seen = true;
            hook["command"] = serde_json::Value::String(command.to_string());
            true
        });
        // Drop the wrapper too if a stale Atlas command was all it held.
        inner.len() == before || !inner.is_empty()
    });
    if current_seen {
        return changed;
    }

    entries.push(serde_json::json!({
        "matcher": "",
        "hooks": [{ "type": "command", "command": command }]
    }));
    true
}

/// Drop the old shell-script `Notification` entry, so it never runs alongside
/// the command hook that replaced it. Returns true when `settings` changed.
fn drop_legacy_notification_hook(settings: &mut serde_json::Value) -> bool {
    let Some(entries) = settings
        .get_mut("hooks")
        .and_then(|h| h.get_mut("Notification"))
        .and_then(|n| n.as_array_mut())
    else {
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
    changed
}

/// Merge Atlas's notification hook into a parsed `settings.json`, dropping any
/// stale shell-script entry. Returns true when `settings` was modified.
fn merge_notification_hook(settings: &mut serde_json::Value, command: &str) -> bool {
    let legacy_dropped = drop_legacy_notification_hook(settings);
    merge_hook(settings, "Notification", HOOK_MARKER, command) || legacy_dropped
}

/// Load `settings.json`. A missing file is an empty object; any other read or
/// parse failure is an error, because the caller must not overwrite a file it
/// could not understand (the user's model, permissions, env and MCP config
/// live there).
fn read_claude_settings(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("not valid JSON: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("could not be read: {e}")),
    }
}

/// Copy the original `settings.json` to `settings.json.atlas-bak`, once. An
/// existing backup is kept: it holds the oldest, pre-Atlas contents.
fn back_up_claude_settings(path: &std::path::Path) -> std::io::Result<()> {
    let mut backup = path.as_os_str().to_owned();
    backup.push(".atlas-bak");
    let backup = std::path::PathBuf::from(backup);
    if !path.exists() || backup.exists() {
        return Ok(());
    }
    std::fs::copy(path, backup).map(|_| ())
}

/// Read-modify-write `~/.claude/settings.json`, applying `merge` and writing
/// back only when it reports a change. Shared by every hook installer.
///
/// A file that cannot be read or parsed is never touched: the failure is
/// logged at error level and the hook is simply not installed.
fn update_claude_settings(
    claude_settings_path: &std::path::Path,
    merge: impl FnOnce(&mut serde_json::Value) -> bool,
    label: &str,
) {
    let mut settings = match read_claude_settings(claude_settings_path) {
        Ok(settings) => settings,
        Err(reason) => {
            log::error!(
                "{} {} — leaving it untouched, so the Atlas {} hook is not installed",
                claude_settings_path.display(),
                reason,
                label
            );
            return;
        }
    };

    if !merge(&mut settings) {
        log::info!("Atlas {} hook already installed", label);
        return;
    }

    let mut json = match serde_json::to_string_pretty(&settings) {
        Ok(json) => json,
        Err(e) => {
            log::warn!("Failed to serialize Claude settings: {}", e);
            return;
        }
    };
    json.push('\n');
    if let Some(parent) = claude_settings_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = back_up_claude_settings(claude_settings_path) {
        log::error!(
            "Could not back up {} — leaving it untouched: {}",
            claude_settings_path.display(),
            e
        );
        return;
    }
    match atomic_write::write_atomic(claude_settings_path, json.as_bytes()) {
        Ok(()) => log::info!("Installed Atlas {} hook", label),
        Err(e) => log::warn!("Failed to write Claude settings: {}", e),
    }
}

/// Install the Atlas notification hook into ~/.claude/settings.json
/// so Claude Code notifies Atlas when it needs input.
fn install_notification_hook(command: &str) {
    let Some(path) = claude_settings_path() else {
        return;
    };
    update_claude_settings(
        &path,
        |settings| merge_notification_hook(settings, command),
        "notification",
    );
}

fn claude_settings_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

/// Install the Atlas session-start hook into ~/.claude/settings.json so Atlas
/// hears the real session id whenever Claude Code rotates to a new one —
/// `/clear` and `/compact` both do, and only this hook says so.
fn install_session_start_hook(command: &str) {
    let Some(path) = claude_settings_path() else {
        return;
    };
    update_claude_settings(
        &path,
        |settings| merge_hook(settings, "SessionStart", SESSION_START_HOOK_MARKER, command),
        "session-start",
    );
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
    let lsp_manager = lsp::LspManager::new();
    let live_sessions = LiveSessionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // macOS can swallow ⌘Escape inside the webview before it ever becomes a
        // JS keydown event (a known wry/WKWebView gap), so `backToSessions`
        // cannot rely on JS alone. A native menu accelerator is delivered by
        // AppKit before the webview sees the keypress, and — unlike a global
        // shortcut — only fires while Atlas is the frontmost app.
        .menu(|app_handle| {
            let menu = Menu::default(app_handle)?;
            let back_to_sessions = MenuItemBuilder::new("Back to Sessions")
                .id(BACK_TO_SESSIONS_MENU_ID)
                .accelerator("CmdOrCtrl+Escape")
                .build(app_handle)?;
            for item in menu.items()? {
                if item.id().0 == WINDOW_SUBMENU_ID {
                    if let Some(submenu) = item.as_submenu() {
                        submenu.append(&back_to_sessions)?;
                    }
                    break;
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().0 == BACK_TO_SESSIONS_MENU_ID {
                let _ = app.emit(BACK_TO_SESSIONS_MENU_ID, ());
            }
        })
        .manage(pty_manager)
        .manage(lsp_manager)
        .manage(live_sessions.clone())
        .manage(commands::files::DocsWatchers::default())
        .invoke_handler(tauri::generate_handler![
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::panel::get_session_dir,
            commands::panel::get_panel_data,
            commands::panel::refresh_panel,
            commands::git::get_git_status,
            commands::git::git_checkout_branch,
            commands::git::list_workspace_repos,
            commands::prs::list_repo_prs,
            commands::prs::gh_viewer,
            commands::prs::open_url,
            commands::stats::get_claude_stats,
            commands::stats::list_resumable_sessions,
            commands::session::start_session_tail,
            commands::session::stop_session_tail,
            commands::session::start_omp_tail,
            commands::session::claude_info,
            commands::files::list_workspace_docs,
            commands::files::list_claude_plans,
            commands::files::list_dir,
            commands::files::read_text_file_at,
            commands::files::write_text_file_at,
            commands::files::start_docs_watch,
            commands::files::stop_docs_watch,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            match panel::watcher::start_watcher(handle) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::error!(
                    "Failed to start panel watcher: {} — panel updates will not work",
                    e
                ),
            }

            let stats_handle = app.handle().clone();
            match commands::stats::start_stats_watcher(stats_handle) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!(
                    "Failed to start stats watcher: {} — live stats updates will not work",
                    e
                ),
            }

            // Separate from the stats watcher above: that one debounces a full
            // recompute at 1s, which the live session view must not wait on.
            let live_handle = app.handle().clone();
            match session::manager::start_live_watcher(live_handle, live_sessions) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!(
                    "Failed to start live session watcher: {} — session updates will not work",
                    e
                ),
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

            // Install the notification and session-start hooks, pointing at
            // this executable — `current_exe()` resolves in both dev and
            // bundled builds.
            match notification_hook_command() {
                Ok(command) => install_notification_hook(&command),
                Err(e) => log::warn!(
                    "Could not resolve the Atlas executable — notification hook not installed: {}",
                    e
                ),
            }
            match session_start_hook_command() {
                Ok(command) => install_session_start_hook(&command),
                Err(e) => log::warn!(
                    "Could not resolve the Atlas executable — session-start hook not installed: {}",
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
    fn a_stale_executable_path_is_replaced_in_place() {
        let mut settings = serde_json::json!({
            "hooks": { "Notification": [{
                "matcher": "",
                "hooks": [
                    { "type": "command", "command": "\"/old/path/atlas\" hook notification" },
                    { "type": "command", "command": "someone-elses-hook" }
                ]
            }] }
        });
        assert!(merge_notification_hook(&mut settings, NEW));
        assert_eq!(
            commands(&settings),
            vec![NEW.to_string(), "someone-elses-hook".to_string()]
        );
        assert!(!merge_notification_hook(&mut settings, NEW));
    }

    #[test]
    fn stale_duplicates_collapse_to_one_current_entry() {
        let mut settings = serde_json::json!({
            "hooks": { "Notification": [
                { "matcher": "", "hooks": [{ "type": "command", "command": "\"/old/atlas\" hook notification" }] },
                { "matcher": "", "hooks": [{ "type": "command", "command": NEW }] }
            ] }
        });
        assert!(merge_notification_hook(&mut settings, NEW));
        assert_eq!(commands(&settings), vec![NEW]);
    }

    #[test]
    fn a_user_hook_that_merely_mentions_the_marker_is_not_ours() {
        let user = "notify-send 'hook notification received'";
        let mut settings = serde_json::json!({
            "hooks": { "Notification": [{
                "matcher": "",
                "hooks": [{ "type": "command", "command": user }]
            }] }
        });
        assert!(merge_notification_hook(&mut settings, NEW));
        assert_eq!(commands(&settings), vec![user.to_string(), NEW.to_string()]);
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

    const NEW_SESSION_START: &str = "\"C:\\Program Files\\Atlas\\Atlas.exe\" hook session-start";

    fn session_start_commands(settings: &serde_json::Value) -> Vec<String> {
        settings["hooks"]["SessionStart"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|entry| entry["hooks"].as_array().unwrap())
            .map(|hook| hook["command"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn installs_session_start_into_empty_settings() {
        let mut settings = serde_json::json!({});
        assert!(merge_hook(
            &mut settings,
            "SessionStart",
            SESSION_START_HOOK_MARKER,
            NEW_SESSION_START
        ));
        assert_eq!(session_start_commands(&settings), vec![NEW_SESSION_START]);
    }

    #[test]
    fn second_session_start_install_is_a_no_op() {
        let mut settings = serde_json::json!({});
        assert!(merge_hook(
            &mut settings,
            "SessionStart",
            SESSION_START_HOOK_MARKER,
            NEW_SESSION_START
        ));
        assert!(!merge_hook(
            &mut settings,
            "SessionStart",
            SESSION_START_HOOK_MARKER,
            NEW_SESSION_START
        ));
        assert_eq!(session_start_commands(&settings), vec![NEW_SESSION_START]);
    }

    /// The two hooks live under different keys, so installing one must never
    /// disturb the other — this is what lets `Notification`'s legacy cleanup
    /// stay scoped to `Notification` alone.
    #[test]
    fn session_start_and_notification_hooks_coexist() {
        let mut settings = serde_json::json!({});
        assert!(merge_notification_hook(&mut settings, NEW));
        assert!(merge_hook(
            &mut settings,
            "SessionStart",
            SESSION_START_HOOK_MARKER,
            NEW_SESSION_START
        ));
        assert_eq!(commands(&settings), vec![NEW]);
        assert_eq!(session_start_commands(&settings), vec![NEW_SESSION_START]);
    }

    #[test]
    fn quotes_the_session_start_executable_path() {
        let command = session_start_hook_command().unwrap();
        assert!(command.starts_with('"'));
        assert!(command.ends_with("\" hook session-start"));
        assert!(command.contains(SESSION_START_HOOK_MARKER));
    }

    fn install(path: &std::path::Path) {
        update_claude_settings(path, |s| merge_notification_hook(s, NEW), "notification");
    }

    #[test]
    fn an_unparseable_settings_file_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let original = "{ \"model\": \"opus\", }";
        std::fs::write(&path, original).unwrap();

        install(&path);

        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn a_non_utf8_settings_file_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let original = [b'{', 0xff, 0xfe, b'}'];
        std::fs::write(&path, original).unwrap();

        install(&path);

        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn a_missing_settings_file_is_created_without_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        install(&path);

        let settings: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(commands(&settings), vec![NEW]);
        assert!(!dir.path().join("settings.json.atlas-bak").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_settings_file_stays_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("dotfiles-settings.json");
        let link = dir.path().join("settings.json");
        std::fs::write(&real, "{\"model\": \"opus\"}").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        install(&link);

        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        let settings: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&real).unwrap()).unwrap();
        assert_eq!(commands(&settings), vec![NEW]);
        assert_eq!(settings["model"], "opus");
    }

    #[test]
    fn the_users_key_order_and_trailing_newline_survive() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{\n  \"zeta\": 1,\n  \"alpha\": 2\n}\n").unwrap();

        install(&path);

        let written = std::fs::read_to_string(&path).unwrap();
        assert!(written.ends_with("}\n"), "{written:?}");
        let zeta = written.find("\"zeta\"").unwrap();
        let alpha = written.find("\"alpha\"").unwrap();
        let hooks = written.find("\"hooks\"").unwrap();
        assert!(zeta < alpha && alpha < hooks, "{written}");
    }

    #[test]
    fn the_original_is_backed_up_once_before_the_first_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let backup = dir.path().join("settings.json.atlas-bak");
        let original = "{\"model\": \"opus\"}";
        std::fs::write(&path, original).unwrap();

        install(&path);
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);

        // A later change must not overwrite the pre-Atlas backup.
        update_claude_settings(
            &path,
            |s| {
                merge_hook(
                    s,
                    "SessionStart",
                    SESSION_START_HOOK_MARKER,
                    NEW_SESSION_START,
                )
            },
            "session-start",
        );
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
    }
}
