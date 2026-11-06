//! Shared reading of Claude Code's `~/.claude/projects/**/*.jsonl` transcripts.
//!
//! `session::live` tails one running session incrementally; the per-`requestId`
//! accumulation and the block walk live here.

use serde_json::Value;
use std::borrow::Cow;
use std::io::BufRead;

/// The lines of a JSONL transcript. A line that is not valid UTF-8 is skipped;
/// any other read error ends the iteration. `BufRead::lines` repeats the same
/// `Err` forever for a persistent I/O error (a directory, a failing disk), so
/// `flatten()` or `continue` on it would spin.
pub(crate) fn jsonl_lines<R: BufRead>(reader: R) -> impl Iterator<Item = String> {
    reader
        .lines()
        .map_while(|line| match line {
            Ok(line) => Some(Some(line)),
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => Some(None),
            Err(_) => None,
        })
        .flatten()
}

/// `dir` with symlinks resolved when it exists, `dir` itself otherwise.
///
/// notify's macOS backend reports real paths, so a watched root reached through
/// a symlink (a dotfile-managed `~/.claude`) must be compared as its real path
/// or none of its events match. Not done on Windows, where `canonicalize`
/// returns `\\?\` verbatim paths that nothing else in the app expects.
pub(crate) fn resolve_symlinks(dir: std::path::PathBuf) -> std::path::PathBuf {
    if cfg!(windows) {
        return dir;
    }
    dir.canonicalize().unwrap_or(dir)
}

pub(crate) fn model_family(model: &str) -> String {
    let m = model.to_ascii_lowercase();
    if m.contains("opus") {
        "Opus".to_string()
    } else if m.contains("fable") {
        "Fable".to_string()
    } else if m.contains("sonnet") {
        "Sonnet".to_string()
    } else if m.contains("haiku") {
        "Haiku".to_string()
    } else {
        model.to_string()
    }
}

// ── Context window ────────────────────────────────────────────────────────────

/// Window assumed for a model we do not recognise.
pub(crate) const DEFAULT_CONTEXT_WINDOW: u64 = 200_000;

/// Raw context window per model family, in tokens. The 1M-window families run
/// with the long-context beta on, so autocompact fires against this full
/// window rather than a 200k cap.
pub(crate) fn context_window_for(model: &str) -> u64 {
    match model_family(model).as_str() {
        "Haiku" => 200_000,
        "Opus" | "Sonnet" | "Fable" => 1_000_000,
        _ => DEFAULT_CONTEXT_WINDOW,
    }
}

/// Context as a fraction (0.0–1.0) of what the session can use before
/// autocompact fires. Can exceed 1.0 with autocompact off; the views clamp.
pub(crate) fn context_pct(tokens: u64, model: &str) -> f64 {
    let window = context_window_for(model);
    tokens as f64 / window as f64
}

// ── Per-request accumulation ──────────────────────────────────────────────────

/// Largest token count taken from a transcript field. No real request comes
/// within orders of magnitude of it; it exists so a corrupt or hostile line
/// carrying `u64::MAX` cannot overflow the sums built from these fields (a
/// panic in debug builds, a silent wrap in release).
const MAX_TOKEN_COUNT: u64 = 1 << 40;

/// A token count read from a JSON field, clamped to `MAX_TOKEN_COUNT`.
pub(crate) fn token_count(value: Option<&Value>) -> u64 {
    value
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        .min(MAX_TOKEN_COUNT)
}

/// One API request's accumulated data. Several assistant lines share a
/// `requestId`, and `output_tokens` rises as the response streams in, so usage
/// is taken from the last line seen and tool names are appended from all of them.
pub(crate) struct ReqData {
    pub model: String,
    pub input_tokens: u64,
    pub cache_read: u64,
    /// All cache writes, whatever the TTL.
    pub cache_create: u64,
    pub output_tokens: u64,
    pub tool_names: Vec<String>,
}

impl ReqData {
    /// Read `message.usage` for a request first seen on this line.
    pub fn from_message(model: &str, msg: &Value) -> Self {
        let mut req = ReqData {
            model: model.to_string(),
            input_tokens: 0,
            cache_read: 0,
            cache_create: 0,
            output_tokens: 0,
            tool_names: Vec::new(),
        };
        req.set_usage(msg);
        req
    }

    /// Replace the usage with `message.usage` from a later line of the request.
    pub fn set_usage(&mut self, msg: &Value) {
        let usage = msg.get("usage").unwrap_or(&Value::Null);
        let field = |name: &str| token_count(usage.get(name));
        self.input_tokens = field("input_tokens");
        self.cache_read = field("cache_read_input_tokens");
        self.cache_create = field("cache_creation_input_tokens");
        self.output_tokens = field("output_tokens");
    }

    /// Context this request carried in — fresh input plus both cache buckets.
    pub fn context(&self) -> u64 {
        self.input_tokens + self.cache_read + self.cache_create
    }

}

// ── Line-level accessors ──────────────────────────────────────────────────────

/// `type` of a transcript line: `assistant`, `user`, `attachment`, `ai-title`, …
pub(crate) fn line_type(obj: &Value) -> &str {
    obj.get("type").and_then(|v| v.as_str()).unwrap_or("")
}

/// The key an assistant line's usage is deduplicated on. Falls back to `uuid`
/// for the occasional line written without a `requestId`.
pub(crate) fn request_key(obj: &Value) -> Option<String> {
    obj.get("requestId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| obj.get("uuid").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// `message.model` of an assistant line, skipping the empty and `<synthetic>`
/// placeholders that carry no real usage.
pub(crate) fn assistant_model(obj: &Value) -> Option<&str> {
    obj.get("message")
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .filter(|m| !m.is_empty() && *m != "<synthetic>")
}

pub(crate) struct ToolUse<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub input: &'a Value,
}

/// `tool_use` blocks of an assistant line's `message`, in call order.
pub(crate) fn tool_uses(msg: &Value) -> Vec<ToolUse<'_>> {
    let Some(content) = msg.get("content").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    content
        .iter()
        .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
        .map(|item| ToolUse {
            id: item.get("id").and_then(|v| v.as_str()).unwrap_or(""),
            name: item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown"),
            input: item.get("input").unwrap_or(&Value::Null),
        })
        .collect()
}

pub(crate) struct ToolResult<'a> {
    pub tool_use_id: &'a str,
    pub is_error: bool,
    pub content: &'a Value,
}

/// `tool_result` blocks of a `user` line whose `message.content` is an array.
pub(crate) fn tool_results(obj: &Value) -> Vec<ToolResult<'_>> {
    let Some(content) = obj
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    content
        .iter()
        .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("tool_result"))
        .map(|item| ToolResult {
            tool_use_id: item
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
            is_error: item
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            content: item.get("content").unwrap_or(&Value::Null),
        })
        .collect()
}

/// What a human typed on a `user` line, or `None` for a line that is not a
/// prompt.
///
/// Claude Code writes a plain prompt as a string, but a prompt with a pasted
/// image or attachment as an array of `text` and `image`/`document` blocks. The
/// array form is joined from its `text` blocks. An array holding a
/// `tool_result` is a tool's answer, not a prompt, and `[Request interrupted by
/// user…]` is Claude Code's marker for an interrupt, not something the human
/// said.
pub(crate) fn user_text(obj: &Value) -> Option<Cow<'_, str>> {
    let text = match obj.get("message")?.get("content")? {
        Value::String(s) => Cow::Borrowed(s.as_str()),
        Value::Array(blocks) => {
            let is_type = |b: &Value, ty: &str| b.get("type").and_then(|t| t.as_str()) == Some(ty);
            if blocks.iter().any(|b| is_type(b, "tool_result")) {
                return None;
            }
            let mut texts = blocks
                .iter()
                .filter(|b| is_type(b, "text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()));
            let first = texts.next()?;
            match texts.next() {
                None => Cow::Borrowed(first),
                Some(second) => {
                    let mut joined = format!("{first}\n{second}");
                    for rest in texts {
                        joined.push('\n');
                        joined.push_str(rest);
                    }
                    Cow::Owned(joined)
                }
            }
        }
        _ => return None,
    };
    (!text.starts_with(INTERRUPT_MARKER)).then_some(text)
}

/// Start of the text Claude Code writes when the user interrupts a turn.
const INTERRUPT_MARKER: &str = "[Request interrupted by user";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unseen_version_of_a_known_family_gets_the_family_window() {
        assert_eq!(
            context_window_for("claude-opus-9-20991231"),
            context_window_for("claude-opus-5")
        );
        assert_eq!(
            context_window_for("some-future-model"),
            DEFAULT_CONTEXT_WINDOW
        );
    }

    #[test]
    fn context_pct_measures_against_the_full_window() {
        // A 1M-window model runs the long-context beta, so autocompact fires
        // against the full 1M rather than a 200k cap.
        assert!((context_pct(500_000, "claude-opus-5") - 0.5).abs() < f64::EPSILON);
        assert!((context_pct(100_000, "claude-haiku-4-5") - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn request_key_prefers_request_id_and_falls_back_to_uuid() {
        let with_req = serde_json::json!({"requestId": "req_1", "uuid": "u1"});
        assert_eq!(request_key(&with_req).as_deref(), Some("req_1"));

        let empty_req = serde_json::json!({"requestId": "", "uuid": "u1"});
        assert_eq!(request_key(&empty_req).as_deref(), Some("u1"));

        let neither = serde_json::json!({"type": "assistant"});
        assert_eq!(request_key(&neither), None);
    }

    #[test]
    fn assistant_model_skips_synthetic_placeholders() {
        let real = serde_json::json!({"message": {"model": "claude-opus-5"}});
        assert_eq!(assistant_model(&real), Some("claude-opus-5"));
        let synthetic = serde_json::json!({"message": {"model": "<synthetic>"}});
        assert_eq!(assistant_model(&synthetic), None);
        let empty = serde_json::json!({"message": {"model": ""}});
        assert_eq!(assistant_model(&empty), None);
    }

    #[test]
    fn tool_uses_reads_id_name_and_input_in_order() {
        let msg = serde_json::json!({"content": [
            {"type": "text", "text": "hi"},
            {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "/repo/a"}},
            {"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "ls"}},
        ]});
        let uses = tool_uses(&msg);
        assert_eq!(uses.len(), 2);
        assert_eq!((uses[0].id, uses[0].name), ("t1", "Read"));
        assert_eq!((uses[1].id, uses[1].name), ("t2", "Bash"));
        assert_eq!(uses[1].input["command"], "ls");
    }

    #[test]
    fn tool_results_reads_only_array_content() {
        let arr = serde_json::json!({"message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "is_error": true, "content": "boom"},
        ]}});
        let results = tool_results(&arr);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tool_use_id, "t1");
        assert!(results[0].is_error);

        let string_content = serde_json::json!({"message": {"content": "hello"}});
        assert!(tool_results(&string_content).is_empty());
    }

    #[test]
    fn req_data_reads_usage_and_derives_context() {
        let msg = serde_json::json!({"usage": {
            "input_tokens": 100,
            "cache_read_input_tokens": 200,
            "cache_creation_input_tokens": 300,
            "output_tokens": 400,
        }});
        let req = ReqData::from_message("claude-sonnet-4-6", &msg);
        assert_eq!(req.context(), 600);
        assert_eq!(req.output_tokens, 400);
    }
}
