//! The error every `#[tauri::command]` rejects with.
//!
//! It crosses IPC as `{ "kind": "<variant>", "message": "...", ...fields }`
//! (internally tagged), so the webview branches on `kind` and shows `message`
//! and never has to match on text. A condition the UI handles as an ordinary
//! outcome (a save `conflict`, a missing `gh` in `RepoPrs.error`, git absent in
//! a panel's `issue`) is an `Ok` value of the command, not one of these.

use std::fmt;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AtlasError {
    /// The caller sent something the command refuses to act on: a relative
    /// path, a malformed branch name, a file the editor cannot open.
    InvalidInput { message: String },
    /// What the command was asked about does not exist: a path, a terminal or
    /// language-server id, a branch.
    NotFound { message: String },
    /// Atlas refused on purpose: the path is outside every folder the Files
    /// screen may touch, or is one it never exposes.
    Forbidden { message: String },
    /// The operating system failed the read, write or spawn.
    Io { message: String },
    /// A program Atlas shells out to is not installed. `message` says how to
    /// install it.
    ToolMissing { tool: String, message: String },
    /// A program ran and failed; `message` is its own explanation.
    ToolFailed { tool: String, message: String },
    /// A program did not finish in time and was killed.
    Timeout { tool: String, message: String },
    /// Data that should have been JSON, UTF-8 or a known format was not.
    Parse { message: String },
    /// A bug or poisoned state on Atlas's side: a lock that a panic left
    /// poisoned, a background task that died.
    Internal { message: String },
}

impl AtlasError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            message: message.into(),
        }
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden {
            message: message.into(),
        }
    }

    /// An OS-level failure with no path to report; takes any error so
    /// `.map_err(AtlasError::io)` works on foreign error types.
    pub fn io(cause: impl fmt::Display) -> Self {
        Self::Io {
            message: cause.to_string(),
        }
    }

    pub fn tool_missing(tool: &str, message: impl Into<String>) -> Self {
        Self::ToolMissing {
            tool: tool.to_string(),
            message: message.into(),
        }
    }

    pub fn tool_failed(tool: &str, message: impl Into<String>) -> Self {
        Self::ToolFailed {
            tool: tool.to_string(),
            message: message.into(),
        }
    }

    pub fn timeout(tool: &str, message: impl Into<String>) -> Self {
        Self::Timeout {
            tool: tool.to_string(),
            message: message.into(),
        }
    }

    pub fn parse(message: impl Into<String>) -> Self {
        Self::Parse {
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    /// An OS error on `path`, worded `<path>: <error>`. A missing path is
    /// `NotFound`; everything else is `Io`.
    pub fn io_at(path: &Path, error: &std::io::Error) -> Self {
        let message = format!("{}: {error}", path.display());
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::NotFound { message }
        } else {
            Self::Io { message }
        }
    }

    /// The text to show the user.
    pub fn message(&self) -> &str {
        match self {
            Self::InvalidInput { message }
            | Self::NotFound { message }
            | Self::Forbidden { message }
            | Self::Io { message }
            | Self::ToolMissing { message, .. }
            | Self::ToolFailed { message, .. }
            | Self::Timeout { message, .. }
            | Self::Parse { message }
            | Self::Internal { message } => message,
        }
    }
}

impl fmt::Display for AtlasError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for AtlasError {}

impl From<std::io::Error> for AtlasError {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::NotFound {
                message: error.to_string(),
            }
        } else {
            Self::Io {
                message: error.to_string(),
            }
        }
    }
}

impl From<serde_json::Error> for AtlasError {
    fn from(error: serde_json::Error) -> Self {
        Self::Parse {
            message: error.to_string(),
        }
    }
}

impl From<notify::Error> for AtlasError {
    fn from(error: notify::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

impl<T> From<std::sync::PoisonError<T>> for AtlasError {
    fn from(_: std::sync::PoisonError<T>) -> Self {
        Self::Internal {
            message: "an internal lock was poisoned by an earlier panic".to_string(),
        }
    }
}

impl From<tokio::task::JoinError> for AtlasError {
    fn from(error: tokio::task::JoinError) -> Self {
        Self::Internal {
            message: format!("a background task failed: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn shape(error: &AtlasError) -> Value {
        serde_json::to_value(error).expect("AtlasError serialises")
    }

    #[test]
    fn every_variant_serialises_as_kind_message_and_its_fields() {
        let cases = [
            (
                AtlasError::invalid_input("bad"),
                json!({ "kind": "invalidInput", "message": "bad" }),
            ),
            (
                AtlasError::not_found("gone"),
                json!({ "kind": "notFound", "message": "gone" }),
            ),
            (
                AtlasError::forbidden("no"),
                json!({ "kind": "forbidden", "message": "no" }),
            ),
            (
                AtlasError::io("disk"),
                json!({ "kind": "io", "message": "disk" }),
            ),
            (
                AtlasError::tool_missing("git", "install git"),
                json!({ "kind": "toolMissing", "tool": "git", "message": "install git" }),
            ),
            (
                AtlasError::tool_failed("gh", "boom"),
                json!({ "kind": "toolFailed", "tool": "gh", "message": "boom" }),
            ),
            (
                AtlasError::timeout("gh", "too slow"),
                json!({ "kind": "timeout", "tool": "gh", "message": "too slow" }),
            ),
            (
                AtlasError::parse("not json"),
                json!({ "kind": "parse", "message": "not json" }),
            ),
            (
                AtlasError::internal("poisoned"),
                json!({ "kind": "internal", "message": "poisoned" }),
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(shape(&error), expected);
        }
    }

    #[test]
    fn display_is_the_message() {
        assert_eq!(
            AtlasError::tool_failed("git", "exit 1").to_string(),
            "exit 1"
        );
    }

    #[test]
    fn a_missing_path_is_not_found_and_anything_else_is_io() {
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(matches!(
            AtlasError::io_at(Path::new("/x"), &missing),
            AtlasError::NotFound { .. }
        ));
        assert!(matches!(
            AtlasError::from(missing),
            AtlasError::NotFound { .. }
        ));
        assert!(matches!(
            AtlasError::io_at(Path::new("/x"), &denied),
            AtlasError::Io { .. }
        ));
        assert!(matches!(AtlasError::from(denied), AtlasError::Io { .. }));
    }

    #[test]
    fn io_at_leads_with_the_path() {
        let error = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let message = AtlasError::io_at(Path::new("/tmp/a"), &error).to_string();
        assert!(message.starts_with("/tmp/a: "), "{message}");
    }

    #[test]
    fn foreign_errors_map_to_their_kind() {
        let parse = serde_json::from_str::<Value>("{").unwrap_err();
        assert!(matches!(AtlasError::from(parse), AtlasError::Parse { .. }));

        let lock = std::sync::Mutex::new(());
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _held = lock.lock().unwrap();
            panic!("poison it");
        }));
        let poisoned = lock.lock().unwrap_err();
        assert!(matches!(
            AtlasError::from(poisoned),
            AtlasError::Internal { .. }
        ));
    }

    #[tokio::test]
    async fn a_panicked_task_is_internal() {
        let joined = tokio::task::spawn_blocking(|| panic!("task died")).await;
        let error = AtlasError::from(joined.unwrap_err());
        assert!(matches!(error, AtlasError::Internal { .. }), "{error:?}");
    }
}
