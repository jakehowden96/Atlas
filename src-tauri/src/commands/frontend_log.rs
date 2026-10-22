//! The webview's log sink. Lines go through the same `log` dispatcher as the
//! backend's, so there is one file, one format and one retention policy, and
//! the webview needs no filesystem access to keep a log.

use serde::Deserialize;
use ts_rs::TS;

/// Longest message kept, in characters. A stack trace fits; a runaway loop
/// logging a serialised store does not fill the day's log.
const MAX_MESSAGE_CHARS: usize = 8 * 1024;

/// Longest scope kept.
const MAX_SCOPE_CHARS: usize = 32;

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
}

impl From<LogLevel> for log::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Error => log::Level::Error,
            LogLevel::Warn => log::Level::Warn,
            LogLevel::Info => log::Level::Info,
        }
    }
}

/// `web:<scope>` with the scope reduced to a short identifier, so a caller
/// cannot impersonate a backend module or break the line format.
fn target_for(scope: &str) -> String {
    let cleaned: String = scope
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(MAX_SCOPE_CHARS)
        .collect();
    if cleaned.is_empty() {
        "web".to_string()
    } else {
        format!("web:{cleaned}")
    }
}

fn clip(message: &str) -> &str {
    match message.char_indices().nth(MAX_MESSAGE_CHARS) {
        Some((end, _)) => &message[..end],
        None => message,
    }
}

#[tauri::command]
pub fn log_write(level: LogLevel, scope: String, message: String) {
    log::log!(target: &target_for(&scope), level.into(), "{}", clip(&message));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_is_reduced_to_a_short_identifier() {
        assert_eq!(target_for("settings"), "web:settings");
        assert_eq!(target_for("a b\n[ERROR] c"), "web:abERRORc");
        assert_eq!(target_for("\n\r "), "web");
        assert_eq!(target_for(&"x".repeat(100)).len(), "web:".len() + 32);
    }

    #[test]
    fn long_messages_are_cut_on_a_character_boundary() {
        let long = "é".repeat(MAX_MESSAGE_CHARS + 10);
        let clipped = clip(&long);
        assert_eq!(clipped.chars().count(), MAX_MESSAGE_CHARS);
        assert_eq!(clip("short"), "short");
    }
}
