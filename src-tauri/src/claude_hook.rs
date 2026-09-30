//! Atlas's entries in Claude Code's `~/.claude/settings.json`: the
//! `Notification` and `SessionStart` hooks that tell Atlas a session needs
//! input or changed its session id (`atlas hook <kind>`, see `hook.rs`).

use crate::atomic_write;
use crate::error::AtlasError;

/// Identifies Atlas's own entry in `hooks.Notification`. The command is
/// `"<exe>" hook notification`, so the argv tail is the part that is stable
/// across install locations and platforms.
const HOOK_MARKER: &str = "hook notification";

/// Identifies Atlas's own entry in `hooks.SessionStart`, the same way.
const SESSION_START_HOOK_MARKER: &str = "hook session-start";

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
fn read_claude_settings(path: &std::path::Path) -> Result<serde_json::Value, AtlasError> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| AtlasError::parse(format!("{} is not valid JSON: {e}", path.display()))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(AtlasError::io_at(path, &e)),
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

/// Serialises Atlas's own read-modify-writes of the file, so the launch install
/// and a Settings toggle cannot interleave. (Claude Code writes it too, and
/// nothing can lock that out.)
static SETTINGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Read-modify-write `~/.claude/settings.json`, applying `merge` and writing
/// back only when it reports a change. Returns whether the file was written.
///
/// A file that cannot be read or parsed is never touched: that is an `Err`
/// describing why, and the hooks are left exactly as they were. The parent
/// directory is created only when there is something to write, so removing the
/// hooks never conjures up `~/.claude`.
fn update_claude_settings(
    claude_settings_path: &std::path::Path,
    merge: impl FnOnce(&mut serde_json::Value) -> bool,
) -> Result<bool, AtlasError> {
    let _guard = SETTINGS_LOCK.lock()?;
    let mut settings = read_claude_settings(claude_settings_path)?;

    if !merge(&mut settings) {
        return Ok(false);
    }

    let mut json = serde_json::to_string_pretty(&settings)?;
    json.push('\n');
    if let Some(parent) = claude_settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AtlasError::io_at(parent, &e))?;
    }
    back_up_claude_settings(claude_settings_path).map_err(|e| {
        AtlasError::io(format!(
            "Could not back up {} — leaving it untouched: {e}",
            claude_settings_path.display()
        ))
    })?;
    atomic_write::write_atomic(claude_settings_path, json.as_bytes())
        .map_err(|e| AtlasError::io_at(claude_settings_path, &e))?;
    Ok(true)
}

fn claude_settings_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

/// Make `settings` carry Atlas's two hooks, pointing at `notification` and
/// `session_start`: `Notification` so Claude Code tells Atlas when it needs
/// input, `SessionStart` so Atlas hears the real session id whenever Claude
/// Code rotates to a new one (`/clear` and `/compact` both do, and only this
/// hook says so). Both merges always run. True when `settings` changed.
fn merge_atlas_hooks(
    settings: &mut serde_json::Value,
    notification: &str,
    session_start: &str,
) -> bool {
    let notification_changed = merge_notification_hook(settings, notification);
    let session_changed = merge_hook(
        settings,
        "SessionStart",
        SESSION_START_HOOK_MARKER,
        session_start,
    );
    notification_changed || session_changed
}

/// Drop Atlas's entries from `hooks[event]`: commands with the exact shape
/// Atlas installs (`is_atlas_command`), never a user's own hook that merely
/// mentions the marker. A wrapper left with no commands goes too, then the
/// event's array if it was emptied, then `hooks` if removing that emptied it —
/// but only structure this removal emptied; an `{}` or `[]` the user left
/// there is theirs. True when anything was removed.
fn remove_hook(settings: &mut serde_json::Value, event: &str, marker: &str) -> bool {
    let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return false;
    };
    let Some(entries) = hooks.get_mut(event).and_then(|e| e.as_array_mut()) else {
        return false;
    };

    let mut removed = false;
    entries.retain_mut(|entry| {
        let Some(inner) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
            return true;
        };
        let before = inner.len();
        inner.retain(|hook| !is_atlas_command(hook_command_str(hook), marker));
        if inner.len() == before {
            return true;
        }
        removed = true;
        !inner.is_empty()
    });
    if removed && entries.is_empty() {
        hooks.remove(event);
        if hooks.is_empty() {
            if let Some(root) = settings.as_object_mut() {
                root.remove("hooks");
            }
        }
    }
    removed
}

/// Remove every hook Atlas installed. True when `settings` changed.
fn remove_atlas_hooks(settings: &mut serde_json::Value) -> bool {
    // Both run; `||` would skip the second removal after the first succeeded.
    let notification = remove_hook(settings, "Notification", HOOK_MARKER);
    let session_start = remove_hook(settings, "SessionStart", SESSION_START_HOOK_MARKER);
    notification || session_start
}

/// True when `settings` has an Atlas-shaped command under `hooks[event]`.
fn has_atlas_hook(settings: &serde_json::Value, event: &str, marker: &str) -> bool {
    settings["hooks"][event].as_array().is_some_and(|entries| {
        entries.iter().any(|entry| {
            entry["hooks"].as_array().is_some_and(|inner| {
                inner
                    .iter()
                    .any(|h| is_atlas_command(hook_command_str(h), marker))
            })
        })
    })
}

/// Whether `~/.claude/settings.json` carries Atlas's hook for `event`; what
/// Settings › Claude Code reports. An unreadable or unparseable file reports
/// false.
fn is_installed(event: &str, marker: &str) -> bool {
    let Some(path) = claude_settings_path() else {
        return false;
    };
    read_claude_settings(&path).is_ok_and(|settings| has_atlas_hook(&settings, event, marker))
}

pub(crate) fn notification_installed() -> bool {
    is_installed("Notification", HOOK_MARKER)
}

pub(crate) fn session_start_installed() -> bool {
    is_installed("SessionStart", SESSION_START_HOOK_MARKER)
}

/// Install (`enabled`) or remove Atlas's hooks in the settings file at `path`.
/// Returns whether the file changed. Removing from a missing file does nothing.
fn apply(
    path: &std::path::Path,
    enabled: bool,
    notification: &str,
    session_start: &str,
) -> Result<bool, AtlasError> {
    update_claude_settings(path, |settings| {
        if enabled {
            merge_atlas_hooks(settings, notification, session_start)
        } else {
            remove_atlas_hooks(settings)
        }
    })
}

/// Set up the hooks as the user's `claudeHook` setting says, at launch: install
/// (pointing at this executable — `current_exe()` resolves in both dev and
/// bundled builds) when on, nothing when off. Failures are logged, never fatal.
pub(crate) fn sync_at_launch(enabled: bool) {
    if !enabled {
        log::info!("Claude Code hook is turned off in Settings; not installing it");
        return;
    }
    match set_hooks(true) {
        Ok(true) => log::info!("Installed Atlas Claude Code hooks"),
        Ok(false) => log::info!("Atlas Claude Code hooks already installed"),
        Err(e) => log::error!("Atlas Claude Code hooks not installed: {e}"),
    }
}

fn set_hooks(enabled: bool) -> Result<bool, AtlasError> {
    let path = claude_settings_path()
        .ok_or_else(|| AtlasError::internal("Could not resolve the home directory"))?;
    let (notification, session_start) = if enabled {
        let exe_error = |e: std::io::Error| {
            AtlasError::io(format!("Could not resolve the Atlas executable: {e}"))
        };
        (
            notification_hook_command().map_err(exe_error)?,
            session_start_hook_command().map_err(exe_error)?,
        )
    } else {
        (String::new(), String::new())
    };
    apply(&path, enabled, &notification, &session_start)
}

/// Settings › Claude Code's switch. Installs or removes Atlas's hooks in
/// `~/.claude/settings.json`; nothing else in that file is touched, and a file
/// that does not parse is left exactly as it is and reported as an error.
#[tauri::command(async)]
pub fn set_claude_hook(enabled: bool) -> Result<(), AtlasError> {
    set_hooks(enabled).map(|changed| {
        log::info!(
            "Atlas Claude Code hooks {}{}",
            if enabled { "installed" } else { "removed" },
            if changed { "" } else { " (no change needed)" }
        );
    })
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

    fn install(path: &std::path::Path) -> Result<bool, AtlasError> {
        update_claude_settings(path, |s| merge_notification_hook(s, NEW))
    }

    #[test]
    fn an_unparseable_settings_file_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let original = "{ \"model\": \"opus\", }";
        std::fs::write(&path, original).unwrap();

        assert!(install(&path).is_err());

        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn a_non_utf8_settings_file_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let original = [b'{', 0xff, 0xfe, b'}'];
        std::fs::write(&path, original).unwrap();

        assert!(install(&path).is_err());

        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn a_missing_settings_file_is_created_without_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        install(&path).unwrap();

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

        install(&link).unwrap();

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

        install(&path).unwrap();

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

        install(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);

        // A later change must not overwrite the pre-Atlas backup.
        update_claude_settings(&path, |s| {
            merge_hook(
                s,
                "SessionStart",
                SESSION_START_HOOK_MARKER,
                NEW_SESSION_START,
            )
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
    }

    /// A settings file as a user with their own hooks might have it, in the
    /// exact form Atlas writes back (pretty, trailing newline), so an
    /// install-then-remove round trip can be compared byte for byte.
    fn users_file() -> String {
        let value = serde_json::json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo pre" }] }
                ],
                "Notification": [
                    { "matcher": "", "hooks": [
                        { "type": "command", "command": "notify-send claude" },
                        { "type": "command", "command": "my-wrapper hook notification --verbose" }
                    ] }
                ]
            },
            "env": { "A": "1" }
        });
        let mut text = serde_json::to_string_pretty(&value).unwrap();
        text.push('\n');
        text
    }

    fn parse(path: &std::path::Path) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn installing_twice_changes_nothing_and_removing_restores_the_users_file_exactly() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let original = users_file();
        std::fs::write(&path, &original).unwrap();

        assert!(apply(&path, true, NEW, NEW_SESSION_START).unwrap());
        let installed = std::fs::read_to_string(&path).unwrap();
        assert_ne!(installed, original);
        assert!(!apply(&path, true, NEW, NEW_SESSION_START).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), installed);

        assert!(apply(&path, false, "", "").unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(!apply(&path, false, "", "").unwrap());
    }

    #[test]
    fn removal_takes_only_atlas_shaped_commands_out_of_a_shared_wrapper() {
        let mut settings = serde_json::json!({
            "hooks": { "Notification": [{
                "matcher": "",
                "hooks": [
                    { "type": "command", "command": "notify-send claude" },
                    { "type": "command", "command": NEW },
                    { "type": "command", "command": "my-wrapper hook notification --verbose" },
                ]
            }]}
        });

        assert!(remove_atlas_hooks(&mut settings));

        // The user's two commands stay in the wrapper they were in — including
        // the one that merely mentions Atlas's marker.
        assert_eq!(
            commands(&settings),
            vec![
                "notify-send claude",
                "my-wrapper hook notification --verbose"
            ]
        );
    }

    #[test]
    fn removal_prunes_the_structure_it_emptied_and_only_that() {
        let mut settings = serde_json::json!({
            "hooks": {
                "Stop": [],
                "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": NEW }] }],
                "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": NEW_SESSION_START }] }],
            }
        });

        assert!(remove_atlas_hooks(&mut settings));

        // Both emptied events are gone; `Stop` was already empty and is the
        // user's, so it and the object holding it stay.
        assert_eq!(settings, serde_json::json!({ "hooks": { "Stop": [] } }));
    }

    #[test]
    fn removal_drops_hooks_entirely_when_atlas_was_all_it_held() {
        let mut settings = serde_json::json!({ "model": "opus" });
        merge_atlas_hooks(&mut settings, NEW, NEW_SESSION_START);
        assert!(remove_atlas_hooks(&mut settings));
        assert_eq!(settings, serde_json::json!({ "model": "opus" }));
    }

    #[test]
    fn removal_with_nothing_installed_is_not_a_change() {
        let mut settings = serde_json::json!({
            "hooks": { "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "mine" }] }] }
        });
        let before = settings.clone();
        assert!(!remove_atlas_hooks(&mut settings));
        assert_eq!(settings, before);
        assert!(!remove_atlas_hooks(&mut serde_json::json!({})));
        assert!(!remove_atlas_hooks(
            &mut serde_json::json!({ "hooks": "nope" })
        ));
    }

    #[test]
    fn removing_from_a_missing_file_writes_nothing_and_creates_no_directory() {
        let dir = tempfile::tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        let path = claude_dir.join("settings.json");

        assert!(!apply(&path, false, "", "").unwrap());

        assert!(!claude_dir.exists());
    }

    #[test]
    fn installing_creates_the_directory_only_because_it_is_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude").join("settings.json");

        assert!(apply(&path, true, NEW, NEW_SESSION_START).unwrap());

        assert_eq!(commands(&parse(&path)), vec![NEW]);
    }

    #[test]
    fn removal_never_touches_a_file_it_cannot_parse() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let original = "{ \"model\": \"opus\", \"hooks\": ";
        std::fs::write(&path, original).unwrap();

        let err = apply(&path, false, "", "").unwrap_err();

        assert!(matches!(err, AtlasError::Parse { .. }), "{err:?}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(!dir.path().join("settings.json.atlas-bak").exists());
    }

    #[test]
    fn the_installed_status_counts_only_atlas_shaped_commands() {
        let mut settings = serde_json::json!({
            "hooks": { "Notification": [{ "matcher": "", "hooks": [
                { "type": "command", "command": "my-wrapper hook notification --verbose" }
            ] }] }
        });
        assert!(!has_atlas_hook(&settings, "Notification", HOOK_MARKER));

        merge_atlas_hooks(&mut settings, NEW, NEW_SESSION_START);
        assert!(has_atlas_hook(&settings, "Notification", HOOK_MARKER));
        assert!(has_atlas_hook(
            &settings,
            "SessionStart",
            SESSION_START_HOOK_MARKER
        ));

        remove_atlas_hooks(&mut settings);
        assert!(!has_atlas_hook(&settings, "Notification", HOOK_MARKER));
    }
}
