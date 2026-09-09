//! `atlas hook <kind>` — the Claude Code hook entry point.
//!
//! Replaces `scripts/atlas-notify-hook.sh` so the same code runs on macOS,
//! Linux and Windows with no `bash` and no `jq` dependency. `main` dispatches
//! here before Tauri starts, so the process never opens a window.

use crate::panel::types::{sessions_dir, ClaudeNotification};
use std::io::Read;
use std::path::Path;
use std::process::ExitCode;

/// `ATLAS_SESSION_ID` becomes a directory name under `~/.atlas/sessions`, so
/// anything outside this alphabet (`.` and `/` in particular) is a traversal.
fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn default_title(notification_type: &str) -> &'static str {
    match notification_type {
        "permission_prompt" => "Claude needs permission",
        "idle_prompt" => "Claude is waiting",
        "auth_success" => "Claude authenticated",
        "elicitation_dialog" => "Claude needs input",
        _ => "Claude Code",
    }
}

/// Build the `notification.json` payload from the raw hook JSON on stdin.
/// Unparseable or partial input degrades the same way the shell script's
/// `jq -r '.field // ""'` did, rather than failing the hook.
fn build_notification(input: &str, timestamp: String) -> ClaudeNotification {
    let parsed: serde_json::Value = serde_json::from_str(input).unwrap_or(serde_json::Value::Null);
    let str_field = |key: &str| {
        parsed
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let notification_type = match str_field("notification_type") {
        s if s.is_empty() => "unknown".to_string(),
        s => s,
    };
    let title = match str_field("title") {
        s if s.is_empty() => default_title(&notification_type).to_string(),
        s => s,
    };

    ClaudeNotification {
        notification_type,
        title,
        message: str_field("message"),
        timestamp,
    }
}

fn write_notification(
    sessions_root: &Path,
    session_id: &str,
    notification: &ClaudeNotification,
) -> std::io::Result<()> {
    let dir = sessions_root.join(session_id);
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string(notification)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(dir.join("notification.json"), json)
}

/// `atlas hook notification` — reads Claude Code hook JSON on stdin and writes
/// `~/.atlas/sessions/<ATLAS_SESSION_ID>/notification.json` for the file
/// watcher to pick up.
pub fn run_hook(kind: &str) -> ExitCode {
    if kind != "notification" {
        eprintln!("atlas hook: unknown hook kind '{}'", kind);
        return ExitCode::FAILURE;
    }

    // Claude also runs outside Atlas, where there is no session to notify.
    let Ok(session_id) = std::env::var("ATLAS_SESSION_ID") else {
        return ExitCode::SUCCESS;
    };
    if session_id.is_empty() {
        return ExitCode::SUCCESS;
    }
    if !is_valid_session_id(&session_id) {
        eprintln!("atlas hook: invalid ATLAS_SESSION_ID");
        return ExitCode::FAILURE;
    }

    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        eprintln!("atlas hook: failed to read stdin");
        return ExitCode::FAILURE;
    }

    let sessions_root = match sessions_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("atlas hook: {}", e);
            return ExitCode::FAILURE;
        }
    };

    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let notification = build_notification(&input, timestamp);

    match write_notification(&sessions_root, &session_id, &notification) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("atlas hook: failed to write notification: {}", e);
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_session_ids() {
        assert!(is_valid_session_id("abc123"));
        assert!(is_valid_session_id("a_b-C9"));
    }

    #[test]
    fn rejects_traversal_session_ids() {
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("../evil"));
        assert!(!is_valid_session_id(".."));
        assert!(!is_valid_session_id("a/b"));
        assert!(!is_valid_session_id("a\\b"));
        assert!(!is_valid_session_id("a.b"));
        assert!(!is_valid_session_id("a b"));
    }

    #[test]
    fn builds_notification_from_hook_json() {
        let n = build_notification(
            r#"{"notification_type":"permission_prompt","message":"test"}"#,
            "2025-01-01T00:00:00Z".to_string(),
        );
        assert_eq!(n.notification_type, "permission_prompt");
        assert_eq!(n.title, "Claude needs permission");
        assert_eq!(n.message, "test");
        assert_eq!(n.timestamp, "2025-01-01T00:00:00Z");
    }

    /// The payload Claude Code really sends, rather than the minimal shape the
    /// tests above invent. The shipped CLI builds its Notification hook input
    /// as the common hook fields plus `message`, `title` and
    /// `notification_type` — so `notification_type` is a real field, and both
    /// this parser and the frontend's allowlist can match on it directly. The
    /// common fields are surplus here and must be ignored, not choke the parse.
    #[test]
    fn reads_the_real_notification_hook_payload() {
        let n = build_notification(
            r#"{
                "session_id": "9f8e7d6c-1234-4321-abcd-0123456789ab",
                "transcript_path": "/home/j/.claude/projects/atlas/9f8e.jsonl",
                "cwd": "/home/j/code/atlas",
                "permission_mode": "default",
                "hook_event_name": "Notification",
                "message": "Claude needs your permission to use Bash",
                "notification_type": "permission_prompt"
            }"#,
            "2025-01-01T00:00:00Z".to_string(),
        );
        assert_eq!(n.notification_type, "permission_prompt");
        assert_eq!(n.message, "Claude needs your permission to use Bash");
        // That payload carries no `title`, so the type-specific default stands.
        assert_eq!(n.title, "Claude needs permission");
    }

    #[test]
    fn explicit_title_wins_over_default() {
        let n = build_notification(
            r#"{"notification_type":"idle_prompt","title":"Custom","message":"m"}"#,
            "t".to_string(),
        );
        assert_eq!(n.title, "Custom");
    }

    #[test]
    fn maps_every_known_notification_type() {
        for (kind, title) in [
            ("permission_prompt", "Claude needs permission"),
            ("idle_prompt", "Claude is waiting"),
            ("auth_success", "Claude authenticated"),
            ("elicitation_dialog", "Claude needs input"),
            ("something_else", "Claude Code"),
        ] {
            let n = build_notification(
                &format!(r#"{{"notification_type":"{}"}}"#, kind),
                "t".to_string(),
            );
            assert_eq!(n.title, title, "for {}", kind);
        }
    }

    #[test]
    fn unparseable_input_degrades_to_unknown() {
        let n = build_notification("not json", "t".to_string());
        assert_eq!(n.notification_type, "unknown");
        assert_eq!(n.title, "Claude Code");
        assert_eq!(n.message, "");
    }

    #[test]
    fn written_json_matches_the_watcher_shape() {
        let dir = tempfile::tempdir().unwrap();
        let n = build_notification(
            r#"{"notification_type":"permission_prompt","message":"test"}"#,
            "2025-01-01T00:00:00Z".to_string(),
        );
        write_notification(dir.path(), "abc123", &n).unwrap();

        let written =
            std::fs::read_to_string(dir.path().join("abc123").join("notification.json")).unwrap();
        let parsed: ClaudeNotification = serde_json::from_str(&written).unwrap();
        assert_eq!(parsed.notification_type, "permission_prompt");
        assert_eq!(parsed.title, "Claude needs permission");
        assert_eq!(parsed.message, "test");
        assert_eq!(parsed.timestamp, "2025-01-01T00:00:00Z");

        // Byte-identical to what the old `jq -n` shell hook emitted.
        assert_eq!(
            written,
            r#"{"notification_type":"permission_prompt","title":"Claude needs permission","message":"test","timestamp":"2025-01-01T00:00:00Z"}"#
        );
    }
}
