//! Shared reading of Claude Code's `~/.claude/projects/**/*.jsonl` transcripts.
//!
//! Two callers read the same files: `commands::stats` aggregates every
//! historical session in bulk, and `session::live` tails one running session
//! incrementally. The pricing table, the per-`requestId` accumulation and the
//! block walk live here so both produce the same numbers from the same bytes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ── Pricing ───────────────────────────────────────────────────────────────────

pub(crate) struct Pricing {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// Approximate API-equivalent pricing per million tokens.
/// Prices are labelled as approximate in the UI; labelled per Anthropic pricing as of 2026-06.
pub(crate) fn pricing_for(model: &str) -> Pricing {
    let m = model.to_ascii_lowercase();
    if m.contains("opus-4") || m.contains("opus-3") || m.contains("fable") {
        // Opus 4.x + fable-5 (conservative estimate — fable pricing not yet published)
        Pricing { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5 }
    } else if m.contains("sonnet-4") || m.contains("sonnet-3-5") || m.contains("sonnet-3") {
        Pricing { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 }
    } else if m.contains("haiku-4") || m.contains("haiku-3-5") {
        Pricing { input: 0.8, output: 4.0, cache_write: 1.0, cache_read: 0.08 }
    } else if m.contains("haiku-3") {
        Pricing { input: 0.25, output: 1.25, cache_write: 0.3, cache_read: 0.03 }
    } else {
        // Unknown model — mid-range Sonnet-tier fallback
        Pricing { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 }
    }
}

pub(crate) fn model_family(model: &str) -> String {
    let m = model.to_ascii_lowercase();
    if m.contains("opus") { "Opus".to_string() }
    else if m.contains("fable") { "Fable".to_string() }
    else if m.contains("sonnet") { "Sonnet".to_string() }
    else if m.contains("haiku") { "Haiku".to_string() }
    else { model.to_string() }
}

// ── Context window ────────────────────────────────────────────────────────────

/// Window assumed for a model we do not recognise.
pub(crate) const DEFAULT_CONTEXT_WINDOW: u64 = 200_000;

/// Usable context window per model family, in tokens.
pub(crate) fn context_window_for(model: &str) -> u64 {
    match model_family(model).as_str() {
        "Haiku" => 200_000,
        "Opus" | "Sonnet" | "Fable" => 1_000_000,
        _ => DEFAULT_CONTEXT_WINDOW,
    }
}

/// Peak context as a fraction (0.0–1.0) of the model's window.
///
/// This is an approximation. The percentage the Claude Code TUI shows is
/// measured against its autocompact threshold, not the raw window, so Atlas's
/// number reads lower than the TUI's for the same session.
pub(crate) fn context_pct(peak_context: u64, model: &str) -> f64 {
    let window = context_window_for(model);
    if window == 0 {
        return 0.0;
    }
    peak_context as f64 / window as f64
}

// ── Per-request accumulation ──────────────────────────────────────────────────

/// One API request's accumulated data. Several assistant lines share a
/// `requestId` and each repeats the same `usage` block, so usage is taken from
/// whichever line is seen first and tool names are appended from all of them.
pub(crate) struct ReqData {
    pub model: String,
    pub input_tokens: u64,
    pub cache_read: u64,
    pub cache_create: u64,
    pub output_tokens: u64,
    pub tool_names: Vec<String>,
}

impl ReqData {
    /// Read `message.usage` for a request first seen on this line.
    pub fn from_message(model: &str, msg: &Value) -> Self {
        let usage = msg.get("usage").unwrap_or(&Value::Null);
        let field = |name: &str| usage.get(name).and_then(|v| v.as_u64()).unwrap_or(0);
        ReqData {
            model: model.to_string(),
            input_tokens: field("input_tokens"),
            cache_read: field("cache_read_input_tokens"),
            cache_create: field("cache_creation_input_tokens"),
            output_tokens: field("output_tokens"),
            tool_names: Vec::new(),
        }
    }

    /// Context this request carried in — fresh input plus both cache buckets.
    pub fn context(&self) -> u64 {
        self.input_tokens + self.cache_read + self.cache_create
    }

    pub fn cost(&self) -> f64 {
        let p = pricing_for(&self.model);
        (self.input_tokens as f64 * p.input
            + self.cache_create as f64 * p.cache_write
            + self.cache_read as f64 * p.cache_read
            + self.output_tokens as f64 * p.output)
            / 1_000_000.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelSessionData {
    pub assistant_msgs: u32,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost_estimate: f64,
    pub tool_calls: u32,
    pub peak_context: u64,
    /// Chars/count from the human's own messages that this model family answered
    /// (attributed per-turn, not blindly summed across every family in the session).
    #[serde(default)]
    pub user_chars: u64,
    #[serde(default)]
    pub user_messages: u32,
    /// Chars/count of prompts this model family sent when spawning a subagent
    /// (the `Agent` tool's `prompt` input) — distinct from the human's own messages.
    #[serde(default)]
    pub subagent_prompt_chars: u64,
    #[serde(default)]
    pub subagent_prompt_count: u32,
}

pub(crate) fn requests_to_by_model(
    requests: HashMap<String, ReqData>,
) -> HashMap<String, ModelSessionData> {
    let mut by_model: HashMap<String, ModelSessionData> = HashMap::new();
    for data in requests.values() {
        let ctx = data.context();
        let cost = data.cost();
        let family = model_family(&data.model);
        let entry = by_model.entry(family).or_default();
        entry.assistant_msgs += 1;
        entry.output_tokens += data.output_tokens;
        entry.cache_creation_tokens += data.cache_create;
        entry.cost_estimate += cost;
        if ctx > entry.peak_context {
            entry.peak_context = ctx;
        }
        entry.tool_calls += data.tool_names.len() as u32;
    }
    by_model
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
            name: item.get("name").and_then(|v| v.as_str()).unwrap_or("unknown"),
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
            tool_use_id: item.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or(""),
            is_error: item.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false),
            content: item.get("content").unwrap_or(&Value::Null),
        })
        .collect()
}

/// `message.content` of a `user` line when it is a plain string — a real typed
/// message rather than an array of `tool_result` blocks.
pub(crate) fn user_text(obj: &Value) -> Option<&str> {
    obj.get("message")
        .and_then(|m| m.get("content"))
        .and_then(|v| v.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_window_is_family_wide_with_a_safe_default() {
        assert_eq!(context_window_for("claude-haiku-4-5"), 200_000);
        assert_eq!(context_window_for("claude-opus-5"), 1_000_000);
        assert_eq!(context_window_for("claude-sonnet-4-6"), 1_000_000);
        assert_eq!(context_window_for("claude-fable-5"), 1_000_000);
        assert_eq!(context_window_for("some-future-model"), DEFAULT_CONTEXT_WINDOW);
    }

    #[test]
    fn context_pct_is_a_fraction_of_the_window() {
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
    fn req_data_reads_usage_and_derives_context_and_cost() {
        let msg = serde_json::json!({"usage": {
            "input_tokens": 100,
            "cache_read_input_tokens": 200,
            "cache_creation_input_tokens": 300,
            "output_tokens": 400,
        }});
        let req = ReqData::from_message("claude-sonnet-4-6", &msg);
        assert_eq!(req.context(), 600);
        // 100*3 + 300*3.75 + 200*0.3 + 400*15 == 7485 per million
        assert!((req.cost() - 7485.0 / 1_000_000.0).abs() < 1e-12);
    }
}
