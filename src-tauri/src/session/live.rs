//! Live per-session state, derived by tailing one session's transcript.
//!
//! Claude Code runs in the alternate screen buffer, so the xterm buffer holds
//! TUI chrome rather than a conversation. The structured source is the
//! session's own `~/.claude/projects/<slug>/<uuid>.jsonl`, which this module
//! reads incrementally — never from the start, because it reaches megabytes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::transcript::{
    assistant_model, context_pct, line_type, request_key, tool_results, tool_uses, user_text,
    ReqData,
};

/// Transcript lines kept for the session view. The design shows the tail of the
/// conversation, not its whole history.
const MAX_LINES: usize = 200;

/// Longest excerpt kept from a tool input or tool result on one rendered line.
const EXCERPT: usize = 140;

// ── Data model ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Running,
    NeedsYou,
    Idle,
    Error,
}

/// Maps to the design's terminal line colours: `User`/`Note` → `--t-user`,
/// `Step`/`Working` → `--t-step`, `Tool` → `--t-tool`, `Alert` → `--t-warn`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineRole {
    User,
    Step,
    Tool,
    Note,
    Working,
    Alert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLine {
    pub role: LineRole,
    pub text: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub text: String,
    /// `pending` | `in_progress` | `completed`, straight from `TodoWrite`.
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    pub task: String,
    pub started_at: Option<String>,
    pub tool_count: u32,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTool {
    pub name: String,
    pub input_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub session_uuid: String,
    pub state: SessionState,
    /// Timestamp of the first line seen.
    pub started_at: Option<String>,
    pub last_activity: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
    pub git_branch: Option<String>,
    /// Newest `MAX_LINES` lines, oldest first.
    pub lines: Vec<TranscriptLine>,
    /// Todos from the most recent `TodoWrite`; last one wins.
    pub plan: Vec<PlanItem>,
    pub subagents: Vec<Subagent>,
    pub tool_calls: u32,
    pub last_tool: Option<String>,
    /// A `tool_use` with no matching `tool_result` — what the permission bar names.
    pub pending_tool: Option<PendingTool>,
    pub output_tokens: u64,
    pub cost_estimate: f64,
    pub peak_context: u64,
    /// Fraction 0.0–1.0 of the model's window. Approximate — see `transcript::context_pct`.
    pub context_pct: f64,
}

impl LiveSession {
    fn new(session_uuid: String) -> Self {
        LiveSession {
            session_uuid,
            state: SessionState::Running,
            started_at: None,
            last_activity: None,
            title: None,
            model: None,
            git_branch: None,
            lines: Vec::new(),
            plan: Vec::new(),
            subagents: Vec::new(),
            tool_calls: 0,
            last_tool: None,
            pending_tool: None,
            output_tokens: 0,
            cost_estimate: 0.0,
            peak_context: 0,
            context_pct: 0.0,
        }
    }
}

// ── Incremental line reading ──────────────────────────────────────────────────

/// Remembers where it stopped in a growing file so the file is never re-read
/// from the start. The trailing bytes of an incomplete line are held back until
/// the newline arrives, so a line written in two flushes still parses once.
struct LineReader {
    offset: u64,
    partial: Vec<u8>,
}

impl LineReader {
    fn new() -> Self {
        LineReader { offset: 0, partial: Vec::new() }
    }

    fn reset(&mut self) {
        self.offset = 0;
        self.partial.clear();
    }

    /// Complete lines appended since the last call. The bool is true when the
    /// file shrank (rotation/rewrite) and the caller must rebuild its state.
    fn read_new(&mut self, path: &Path) -> (Vec<String>, bool) {
        let Ok(meta) = std::fs::metadata(path) else {
            return (Vec::new(), false);
        };
        let len = meta.len();
        let rewound = len < self.offset;
        if rewound {
            self.reset();
        }
        if len == self.offset {
            return (Vec::new(), rewound);
        }

        let Ok(mut file) = std::fs::File::open(path) else {
            return (Vec::new(), rewound);
        };
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return (Vec::new(), rewound);
        }
        let mut buf = Vec::new();
        let Ok(read) = file.read_to_end(&mut buf) else {
            return (Vec::new(), rewound);
        };
        self.offset += read as u64;
        self.partial.extend_from_slice(&buf);

        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(pos) = self.partial[start..].iter().position(|b| *b == b'\n') {
            let end = start + pos;
            lines.push(String::from_utf8_lossy(&self.partial[start..end]).into_owned());
            start = end + 1;
        }
        self.partial.drain(..start);
        (lines, rewound)
    }
}

// ── Subagent transcripts ──────────────────────────────────────────────────────

/// Counts `tool_use` blocks in one subagent's own transcript.
///
/// Subagent turns are not written into the parent file — every line there is
/// `isSidechain: false`. Each `Agent` call gets
/// `<dir>/<session uuid>/subagents/agent-<id>.jsonl` plus a sibling
/// `agent-<id>.meta.json` whose `toolUseId` is the parent's `tool_use` id.
struct SubagentCounter {
    reader: LineReader,
    tool_count: u32,
}

impl SubagentCounter {
    fn new() -> Self {
        SubagentCounter { reader: LineReader::new(), tool_count: 0 }
    }

    /// Returns true when the count changed.
    fn poll(&mut self, path: &Path) -> bool {
        let (lines, rewound) = self.reader.read_new(path);
        if rewound {
            self.tool_count = 0;
        }
        if lines.is_empty() {
            return rewound;
        }
        let before = self.tool_count;
        for raw in &lines {
            let Ok(obj) = serde_json::from_str::<Value>(raw) else {
                continue;
            };
            if line_type(&obj) != "assistant" {
                continue;
            }
            let msg = obj.get("message").unwrap_or(&Value::Null);
            self.tool_count += tool_uses(msg).len() as u32;
        }
        rewound || self.tool_count != before
    }
}

// ── The tail ──────────────────────────────────────────────────────────────────

/// One session's transcript tail plus the state folded out of it.
pub struct SessionTail {
    path: PathBuf,
    /// `<transcript dir>/<session uuid>/subagents`.
    subagents_dir: PathBuf,
    reader: LineReader,
    session: LiveSession,
    /// requestId -> usage, so lines sharing a request are counted once.
    requests: HashMap<String, ReqData>,
    /// Unanswered `tool_use` blocks in call order: (id, name, input summary).
    outstanding: Vec<(String, String, String)>,
    /// `tool_use` id -> index into `session.subagents`.
    subagent_index: HashMap<String, usize>,
    /// Subagent file stem -> its incremental tool counter.
    subagent_files: HashMap<String, SubagentCounter>,
    /// `stop_reason` of the newest assistant line.
    last_stop_reason: Option<String>,
    /// Line currently displayed as `Working`, and the role it really has.
    working: Option<(usize, LineRole)>,
}

impl SessionTail {
    pub fn new(session_uuid: String, path: PathBuf) -> Self {
        let subagents_dir = path
            .parent()
            .map(|p| p.join(&session_uuid).join("subagents"))
            .unwrap_or_else(|| PathBuf::from("subagents"));
        SessionTail {
            path,
            subagents_dir,
            reader: LineReader::new(),
            session: LiveSession::new(session_uuid),
            requests: HashMap::new(),
            outstanding: Vec::new(),
            subagent_index: HashMap::new(),
            subagent_files: HashMap::new(),
            last_stop_reason: None,
            working: None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn session(&self) -> &LiveSession {
        &self.session
    }

    /// Byte offset the next read starts from — never rewinds while the file
    /// grows. Exposed so the tests can assert the tail really is incremental.
    #[cfg(test)]
    pub fn offset(&self) -> u64 {
        self.reader.offset
    }

    /// Fold in everything appended since the last call. Returns true when
    /// anything changed, i.e. when a `session-update` is worth emitting.
    pub fn poll(&mut self) -> bool {
        // Withdrawn first, while the recorded line index is still valid.
        self.clear_working_marker();
        let (lines, rewound) = self.reader.read_new(&self.path);
        if rewound {
            self.rebuild();
        }
        for raw in &lines {
            self.fold(raw);
        }
        // After folding: a subagent is only tracked once its `Agent` call is read.
        let subagents_changed = self.poll_subagents();
        if lines.is_empty() && !rewound && !subagents_changed {
            self.apply_working_marker();
            return false;
        }
        self.finalize();
        true
    }

    /// The file shrank, so everything derived from it is stale. `LineReader`
    /// has already rewound to 0; drop the folded state and re-read from there.
    fn rebuild(&mut self) {
        let uuid = std::mem::take(&mut self.session.session_uuid);
        self.session = LiveSession::new(uuid);
        self.requests.clear();
        self.outstanding.clear();
        self.subagent_index.clear();
        self.subagent_files.clear();
        self.last_stop_reason = None;
        self.working = None;
    }

    fn fold(&mut self, raw: &str) {
        let Ok(obj) = serde_json::from_str::<Value>(raw) else {
            return;
        };

        let timestamp = obj
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(ts) = &timestamp {
            if self.session.started_at.is_none() {
                self.session.started_at = Some(ts.clone());
            }
            self.session.last_activity = Some(ts.clone());
        }
        if let Some(branch) = obj.get("gitBranch").and_then(|v| v.as_str()) {
            self.session.git_branch = Some(branch.to_string());
        }

        match line_type(&obj) {
            "user" => self.fold_user(&obj, timestamp),
            "assistant" => self.fold_assistant(&obj, timestamp),
            "ai-title" => {
                if let Some(title) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                    self.session.title = Some(title.to_string());
                }
            }
            _ => {}
        }
    }

    fn fold_user(&mut self, obj: &Value, timestamp: Option<String>) {
        // `isMeta` marks content injected by a hook or skill, not typed by the human.
        let is_meta = obj.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
        if let Some(text) = user_text(obj) {
            if !is_meta {
                self.push_line(LineRole::User, format!("> {}", excerpt(text)), timestamp);
            }
            return;
        }
        for result in tool_results(obj) {
            self.outstanding.retain(|(id, _, _)| id != result.tool_use_id);
            if let Some(&idx) = self.subagent_index.get(result.tool_use_id) {
                self.session.subagents[idx].done = true;
            }
            let role = if result.is_error { LineRole::Alert } else { LineRole::Tool };
            let text = format!("  {}", excerpt(&result_text(result.content)));
            self.push_line(role, text, timestamp.clone());
        }
    }

    fn fold_assistant(&mut self, obj: &Value, timestamp: Option<String>) {
        let msg = obj.get("message").unwrap_or(&Value::Null);
        if let Some(stop) = msg.get("stop_reason").and_then(|v| v.as_str()) {
            self.last_stop_reason = Some(stop.to_string());
        }

        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            for block in content {
                // `thinking` blocks are deliberately not surfaced.
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                        if !text.trim().is_empty() {
                            self.push_line(
                                LineRole::Note,
                                excerpt(text),
                                timestamp.clone(),
                            );
                        }
                    }
                }
            }
        }

        let mut new_tools: Vec<String> = Vec::new();
        for tool in tool_uses(msg) {
            let summary = input_summary(tool.input);
            self.push_line(
                LineRole::Step,
                format!("* {} {}", tool.name, summary).trim_end().to_string(),
                timestamp.clone(),
            );
            self.outstanding
                .push((tool.id.to_string(), tool.name.to_string(), summary.clone()));
            self.session.last_tool = Some(tool.name.to_string());
            new_tools.push(tool.name.to_string());

            if tool.name == "TodoWrite" {
                self.session.plan = plan_from_todos(tool.input);
            }
            // `Agent` is this CLI's spawn tool; `Task` is the name the design uses.
            if tool.name == "Agent" || tool.name == "Task" {
                self.subagent_index
                    .insert(tool.id.to_string(), self.session.subagents.len());
                self.session.subagents.push(Subagent {
                    task: subagent_task(tool.input),
                    started_at: timestamp.clone(),
                    tool_count: 0,
                    done: false,
                });
            }
        }

        // Usage is repeated on every line of a request — take it once.
        if let (Some(model), Some(key)) = (assistant_model(obj), request_key(obj)) {
            self.session.model = Some(model.to_string());
            let entry = self
                .requests
                .entry(key)
                .or_insert_with(|| ReqData::from_message(model, msg));
            entry.tool_names.extend(new_tools);
        }
    }

    fn push_line(&mut self, role: LineRole, text: String, timestamp: Option<String>) {
        self.session.lines.push(TranscriptLine { role, text, timestamp });
        if self.session.lines.len() > MAX_LINES {
            let overflow = self.session.lines.len() - MAX_LINES;
            self.session.lines.drain(..overflow);
        }
    }

    fn finalize(&mut self) {
        let mut output_tokens = 0;
        let mut cost_estimate = 0.0;
        let mut peak_context = 0;
        let mut tool_calls = 0;
        for req in self.requests.values() {
            output_tokens += req.output_tokens;
            cost_estimate += req.cost();
            peak_context = peak_context.max(req.context());
            tool_calls += req.tool_names.len() as u32;
        }
        self.session.output_tokens = output_tokens;
        self.session.cost_estimate = cost_estimate;
        self.session.peak_context = peak_context;
        self.session.tool_calls = tool_calls;
        self.session.context_pct =
            context_pct(peak_context, self.session.model.as_deref().unwrap_or(""));

        // The oldest unanswered call is the one actually blocking.
        self.session.pending_tool =
            self.outstanding
                .first()
                .map(|(_, name, summary)| PendingTool {
                    name: name.clone(),
                    input_summary: summary.clone(),
                });

        // `NeedsYou` and `Error` are set from outside — the Notification hook and
        // the PTY exit code respectively. The transcript only separates the two
        // states it can see.
        self.session.state = if self.session.pending_tool.is_none()
            && self.last_stop_reason.as_deref() == Some("end_turn")
        {
            SessionState::Idle
        } else {
            SessionState::Running
        };

        self.apply_working_marker();
    }

    /// Restore the real role of the line we dressed as `Working`. Called before
    /// folding, while the recorded index is still valid.
    fn clear_working_marker(&mut self) {
        if let Some((idx, role)) = self.working.take() {
            if let Some(line) = self.session.lines.get_mut(idx) {
                line.role = role;
            }
        }
    }

    fn apply_working_marker(&mut self) {
        if self.session.state != SessionState::Running {
            return;
        }
        let Some(idx) = self.session.lines.len().checked_sub(1) else {
            return;
        };
        self.working = Some((idx, self.session.lines[idx].role));
        self.session.lines[idx].role = LineRole::Working;
    }

    /// Refresh `tool_count` for every subagent whose own transcript has grown.
    fn poll_subagents(&mut self) -> bool {
        if self.subagent_index.is_empty() {
            return false;
        }
        let Ok(entries) = std::fs::read_dir(&self.subagents_dir) else {
            return false;
        };
        let mut changed = false;
        for entry in entries.flatten() {
            let meta_path = entry.path();
            let Some(stem) = meta_path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_suffix(".meta.json"))
            else {
                continue;
            };
            let stem = stem.to_string();
            let Some(tool_use_id) = std::fs::read_to_string(&meta_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| {
                    v.get("toolUseId")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                })
            else {
                continue;
            };
            let Some(&idx) = self.subagent_index.get(&tool_use_id) else {
                continue;
            };
            let jsonl = self.subagents_dir.join(format!("{}.jsonl", stem));
            let counter = self
                .subagent_files
                .entry(stem)
                .or_insert_with(SubagentCounter::new);
            if counter.poll(&jsonl) {
                self.session.subagents[idx].tool_count = counter.tool_count;
                changed = true;
            }
        }
        changed
    }
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

/// One line, trimmed and capped — transcript text is multi-line and long.
fn excerpt(text: &str) -> String {
    let first = text.trim().lines().next().unwrap_or("").trim();
    if first.chars().count() <= EXCERPT {
        return first.to_string();
    }
    let cut: String = first.chars().take(EXCERPT).collect();
    format!("{}…", cut)
}

/// `tool_result.content` is usually a string but can be an array of blocks.
fn result_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// The most identifying field of a tool's input, for `* Bash pnpm test`.
fn input_summary(input: &Value) -> String {
    for key in ["command", "file_path", "path", "pattern", "description", "url", "prompt"] {
        if let Some(value) = input.get(key).and_then(|v| v.as_str()) {
            return excerpt(value);
        }
    }
    String::new()
}

fn plan_from_todos(input: &Value) -> Vec<PlanItem> {
    input
        .get("todos")
        .and_then(|v| v.as_array())
        .map(|todos| {
            todos
                .iter()
                .filter_map(|todo| {
                    let text = todo.get("content").and_then(|v| v.as_str())?;
                    Some(PlanItem {
                        text: text.to_string(),
                        status: todo
                            .get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("pending")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn subagent_task(input: &Value) -> String {
    for key in ["description", "subagent_type", "prompt"] {
        if let Some(value) = input.get(key).and_then(|v| v.as_str()) {
            if !value.trim().is_empty() {
                return excerpt(value);
            }
        }
    }
    "Subagent".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A ~200-line slice of a real transcript from `~/.claude/projects/`, with
    /// absolute paths scrubbed and a short format-faithful tail appended so the
    /// TodoWrite plan, the subagent list and the pending tool are all covered.
    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/session.jsonl");

    const UUID: &str = "11111111-2222-4333-8444-555555555555";

    fn fixture_lines() -> Vec<String> {
        std::fs::read_to_string(FIXTURE)
            .expect("fixture is checked in")
            .lines()
            .map(|l| l.to_string())
            .collect()
    }

    /// Write `lines` into a temp dir laid out the way Claude Code does, and
    /// return the tail plus the dir (kept alive for the test's duration).
    fn tail_with(lines: &[String]) -> (tempfile::TempDir, SessionTail) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{}.jsonl", UUID));
        let mut file = std::fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{}", line).unwrap();
        }
        drop(file);
        (dir, SessionTail::new(UUID.to_string(), path))
    }

    fn append(path: &Path, lines: &[String]) {
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        for line in lines {
            writeln!(file, "{}", line).unwrap();
        }
    }

    #[test]
    fn fixture_has_the_shape_the_tests_rely_on() {
        let lines = fixture_lines();
        assert!(
            (150..=250).contains(&lines.len()),
            "fixture is ~200 lines, got {}",
            lines.len()
        );
        // No drive letters, no home directories, no project slugs naming one.
        for needle in ["C:\\\\", "C:/", "/Users/", "Users-"] {
            assert!(
                !lines.iter().any(|l| l.contains(needle)),
                "the fixture still leaks a real path ({needle})"
            );
        }
    }

    #[test]
    fn deduplicates_usage_across_lines_sharing_a_request_id() {
        let lines = fixture_lines();
        let (_dir, mut tail) = tail_with(&lines);
        assert!(tail.poll());

        // What counting every assistant line instead of deduping would give.
        let mut naive_output = 0u64;
        let mut assistant_lines = 0;
        for raw in &lines {
            let obj: Value = serde_json::from_str(raw).unwrap();
            if line_type(&obj) != "assistant" || assistant_model(&obj).is_none() {
                continue;
            }
            assistant_lines += 1;
            naive_output += obj["message"]["usage"]["output_tokens"].as_u64().unwrap_or(0);
        }

        assert!(
            tail.requests.len() < assistant_lines,
            "several lines share one requestId ({} requests from {} lines)",
            tail.requests.len(),
            assistant_lines
        );
        assert!(
            tail.session().output_tokens < naive_output,
            "deduped output {} must be below the per-line sum {}",
            tail.session().output_tokens,
            naive_output
        );
    }

    #[test]
    fn excludes_is_meta_lines_from_the_transcript() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        assert!(
            !tail
                .session()
                .lines
                .iter()
                .any(|l| l.text.contains("<system-reminder>injected")),
            "isMeta content must not reach the transcript preview"
        );
        assert!(
            tail.session()
                .lines
                .iter()
                .any(|l| l.text == "> run the tests please"),
            "real user messages are kept, prefixed"
        );
    }

    #[test]
    fn unanswered_tool_use_becomes_the_pending_tool() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        let pending = tail.session().pending_tool.as_ref().expect("last call is unanswered");
        assert_eq!(pending.name, "Bash");
        assert_eq!(pending.input_summary, "pnpm test");
        assert_eq!(tail.session().state, SessionState::Running);
    }

    #[test]
    fn todo_write_populates_the_plan_with_its_statuses() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        let plan = &tail.session().plan;
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].text, "Extract the shared parser");
        assert_eq!(plan[0].status, "completed");
        assert_eq!(plan[1].status, "in_progress");
        assert_eq!(plan[2].status, "pending");
    }

    #[test]
    fn agent_calls_become_subagents_and_their_results_mark_them_done() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        let subagents = &tail.session().subagents;
        assert!(!subagents.is_empty(), "the fixture spawns subagents");
        assert!(
            subagents.iter().any(|s| s.task == "Check the parser" && s.done),
            "an answered Agent call is done: {:?}",
            subagents
        );
    }

    #[test]
    fn a_failed_tool_result_is_an_alert_line() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        assert!(
            tail.session()
                .lines
                .iter()
                .any(|l| l.role == LineRole::Alert && l.text.contains("could not compile")),
            "is_error results render as Alert"
        );
    }

    #[test]
    fn an_incremental_append_parses_only_the_new_lines() {
        let all = fixture_lines();
        let split = all.len() / 2;
        let (dir, mut tail) = tail_with(&all[..split]);
        assert!(tail.poll());

        let first_offset = tail.offset();
        assert!(first_offset > 0);
        let lines_after_first = tail.session().lines.len();
        let requests_after_first = tail.requests.len();

        // Nothing appended — nothing re-read, nothing re-parsed.
        assert!(!tail.poll(), "an unchanged file yields no update");
        assert_eq!(tail.offset(), first_offset, "the offset does not rewind");
        assert_eq!(tail.session().lines.len(), lines_after_first);

        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(&path, &all[split..]);
        assert!(tail.poll());

        assert!(
            tail.offset() > first_offset,
            "the offset advanced past the first read"
        );
        assert!(tail.requests.len() > requests_after_first, "new requests folded in");
        // Parsing from 0 again would double every request's usage.
        let (_dir2, mut whole) = tail_with(&all);
        whole.poll();
        assert_eq!(tail.session().output_tokens, whole.session().output_tokens);
        assert_eq!(tail.session().tool_calls, whole.session().tool_calls);
        assert_eq!(tail.session().peak_context, whole.session().peak_context);
    }

    #[test]
    fn a_line_split_across_two_writes_is_parsed_once_it_completes() {
        let (dir, mut tail) = tail_with(&[]);
        let path = dir.path().join(format!("{}.jsonl", UUID));
        let line = r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z"}"#;
        let (head, rest) = line.split_at(40);

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        write!(file, "{}", head).unwrap();
        drop(file);
        assert!(!tail.poll(), "a partial line yields nothing yet");
        assert!(tail.session().lines.is_empty());

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{}", rest).unwrap();
        drop(file);
        assert!(tail.poll());
        assert_eq!(tail.session().lines.len(), 1);
        assert_eq!(tail.session().lines[0].text, "> hello");
    }

    #[test]
    fn a_shrinking_file_is_rebuilt_from_zero() {
        let all = fixture_lines();
        let (dir, mut tail) = tail_with(&all);
        tail.poll();
        assert!(tail.offset() > 0);

        // Rotation: the file is replaced by a much shorter one.
        let path = dir.path().join(format!("{}.jsonl", UUID));
        std::fs::write(
            &path,
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"fresh start\"}}\n",
        )
        .unwrap();

        assert!(tail.poll());
        assert_eq!(tail.session().lines.len(), 1);
        assert_eq!(tail.session().lines[0].text, "> fresh start");
        assert_eq!(tail.session().output_tokens, 0, "stale usage is dropped");
    }

    #[test]
    fn cost_and_peak_context_match_the_bulk_stats_parser() {
        let (dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();

        let stats_path = dir.path().join(format!("{}.jsonl", UUID));
        let record = crate::commands::stats::parse_session(&stats_path).unwrap();

        assert_eq!(tail.session().peak_context, record.peak_context);
        assert_eq!(tail.session().output_tokens, record.output_tokens);
        assert!(
            (tail.session().cost_estimate - record.cost_estimate).abs() < 1e-9,
            "live cost {} vs stats cost {}",
            tail.session().cost_estimate,
            record.cost_estimate
        );
    }

    #[test]
    fn subagent_tool_counts_come_from_the_subagent_transcript() {
        let all = fixture_lines();
        let (dir, mut tail) = tail_with(&all);

        // Claude Code writes each subagent's turns to its own file, keyed back to
        // the parent's tool_use id by a sibling .meta.json.
        let subagents = dir.path().join(UUID).join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        std::fs::write(
            subagents.join("agent-abc.meta.json"),
            r#"{"agentType":"Explore","description":"Check the parser","toolUseId":"toolu_agent1","spawnDepth":1}"#,
        )
        .unwrap();
        std::fs::write(
            subagents.join("agent-abc.jsonl"),
            concat!(
                r#"{"isSidechain":true,"type":"assistant","requestId":"r1","message":{"model":"claude-opus-5","content":[{"type":"tool_use","id":"s1","name":"Read","input":{}}],"usage":{"output_tokens":5}}}"#,
                "\n",
                r#"{"isSidechain":true,"type":"assistant","requestId":"r2","message":{"model":"claude-opus-5","content":[{"type":"tool_use","id":"s2","name":"Grep","input":{}}],"usage":{"output_tokens":5}}}"#,
                "\n",
            ),
        )
        .unwrap();

        tail.poll();
        let agent = tail
            .session()
            .subagents
            .iter()
            .find(|s| s.task == "Check the parser")
            .expect("the Agent call is tracked");
        assert_eq!(agent.tool_count, 2);
    }

    #[test]
    fn the_last_line_is_marked_working_only_while_running() {
        let (dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        assert_eq!(tail.session().state, SessionState::Running);
        let last = tail.session().lines.last().unwrap();
        assert_eq!(last.role, LineRole::Working);

        // Answer the pending call and end the turn — the marker is withdrawn and
        // the line it borrowed gets its real role back.
        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(
            &path,
            &[
                r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_pending1","content":"ok","is_error":false}]},"timestamp":"2026-09-07T21:51:00.000Z"}"#.to_string(),
                r#"{"type":"assistant","requestId":"req_done","message":{"model":"claude-opus-5","content":[{"type":"text","text":"All green."}],"stop_reason":"end_turn","usage":{"output_tokens":10}},"timestamp":"2026-09-07T21:51:01.000Z"}"#.to_string(),
            ],
        );
        assert!(tail.poll());
        assert_eq!(tail.session().state, SessionState::Idle);
        assert!(tail.session().pending_tool.is_none());
        assert!(
            !tail.session().lines.iter().any(|l| l.role == LineRole::Working),
            "an idle session has no working line"
        );
        assert_eq!(tail.session().lines.last().unwrap().role, LineRole::Note);
    }

    #[test]
    fn the_line_ring_is_capped() {
        let mut lines = Vec::new();
        for i in 0..(MAX_LINES + 50) {
            lines.push(format!(
                r#"{{"type":"user","message":{{"role":"user","content":"msg {}"}}}}"#,
                i
            ));
        }
        let (_dir, mut tail) = tail_with(&lines);
        tail.poll();
        assert_eq!(tail.session().lines.len(), MAX_LINES);
        assert_eq!(
            tail.session().lines[0].text,
            format!("> msg {}", 50),
            "the oldest lines are dropped first"
        );
    }
}
