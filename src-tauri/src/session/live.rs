//! Live per-session state, derived by tailing one session's transcript.
//!
//! Claude Code runs in the alternate screen buffer, so the xterm buffer holds
//! TUI chrome rather than a conversation. The structured source is the
//! session's own `~/.claude/projects/<slug>/<uuid>.jsonl`, which this module
//! reads incrementally — never from the start, because it reaches megabytes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::transcript::{
    assistant_model, context_pct, line_type, request_key, tool_results, tool_uses, user_text,
    ReqData,
};

/// Transcript lines kept for the session view. The design shows the tail of the
/// conversation, not its whole history.
pub(super) const MAX_LINES: usize = 200;

/// Longest excerpt kept from a tool input or tool result on one rendered line.
const EXCERPT: usize = 140;

/// Longest prompt kept for the Sessions grid card.
const PROMPT_SUMMARY: usize = 400;

/// Longest reply kept for the Sessions grid card — long enough that a closing
/// question survives.
pub(super) const REPLY_SUMMARY: usize = 4000;

/// Longest assistant note kept on one transcript line — enough for the grid
/// card's feed to show a few lines of prose, not just the first.
const NOTE_SUMMARY: usize = 600;

// ── Data model ────────────────────────────────────────────────────────────────

/// The serde mirror of the `SessionState` union in `src/types/session.ts`.
///
/// Claude Code's tail only ever constructs `Running` and `Idle` — its
/// `finalize` picks between them from the transcript, which cannot see a
/// permission prompt; `buildTiles` in `overview.ts` folds that needs-you in
/// from the Notification hook's per-tab flag. OMP has no such hook, but its
/// `ask` tool is in the transcript, so `omp::OmpTail` sets `NeedsYou` itself
/// while one is unanswered. `Error` is produced entirely on the frontend:
/// `pendingLive` maps a workspace row whose `status` is `"error"`.
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
    /// Agent/Task `subagent_type`, `general-purpose` when omitted; a workflow
    /// row's `agentType`.
    pub agent_type: Option<String>,
    pub started_at: Option<String>,
    /// When it stopped, so a finished agent shows how long it took rather than
    /// a clock that keeps running. None while it is still going, and also when
    /// the line that ended it carried no timestamp — `done` is the flag.
    pub finished_at: Option<String>,
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
    /// Context the newest request carried, plus the reply it produced — the
    /// number Claude Code's own status line shows, which is read off the newest
    /// assistant message the same way (`context_window.total_input_tokens` plus
    /// `total_output_tokens`). Falls with a compact or a `/clear`, unlike
    /// `peak_context`.
    pub context_tokens: u64,
    /// Highest context any one request in this session carried. Kept for the
    /// historical record in Stats; the live views show `context_tokens`.
    pub peak_context: u64,
    /// Fraction 0.0–1.0 of what the session can use before autocompact fires,
    /// from `context_tokens` — see `transcript::context_pct`.
    pub context_pct: f64,
    /// The newest user prompt, for the Sessions grid card. None for a
    /// `<task-notification>` or a local slash command.
    pub last_prompt: Option<String>,
    /// The newest assistant reply's text, for the Sessions grid card. Cleared
    /// the moment a new prompt lands.
    pub last_reply: Option<String>,
    /// When the last turn ended, from its `turn_duration` system line.
    pub turn_ended_at: Option<String>,
    /// How long the last turn ran, from its `turn_duration` system line.
    pub turn_duration_ms: Option<u64>,
}

impl LiveSession {
    pub(super) fn new(session_uuid: String) -> Self {
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
            context_tokens: 0,
            peak_context: 0,
            context_pct: 0.0,
            last_prompt: None,
            last_reply: None,
            turn_ended_at: None,
            turn_duration_ms: None,
        }
    }
}

// ── Incremental line reading ──────────────────────────────────────────────────

/// Most bytes one `read_new` takes from the file. A transcript resumed after a
/// long session is megabytes; reading it in bounded chunks and folding each
/// before the next keeps memory at one chunk instead of a few copies of the file.
const READ_CHUNK: u64 = 1 << 20;

/// Most bytes from the start of the file kept to tell an append from a
/// replacement: the first line, which carries the session id and a timestamp.
/// Capped because the first line of a `file-history-snapshot` can be long, and
/// because the fixed prefix every Claude transcript line begins with (`{"parentUuid":null,…`)
/// is not enough on its own to tell two files apart.
const HEAD_LEN: usize = 1024;

/// What one `LineReader::read_new` call produced.
pub(super) struct ReadBatch {
    /// Complete lines, in file order.
    pub lines: Vec<String>,
    /// The file was replaced or shrank: the reader restarted at byte 0 and the
    /// caller must drop the state it folded from the old contents first.
    pub rewound: bool,
    /// More of the file is waiting; call again before treating the tail as current.
    pub more: bool,
}

impl ReadBatch {
    fn nothing(rewound: bool) -> Self {
        ReadBatch {
            lines: Vec::new(),
            rewound,
            more: false,
        }
    }
}

/// Remembers where it stopped in a growing file so the file is never re-read
/// from the start. The trailing bytes of an incomplete line are held back until
/// the newline arrives, so a line written in two flushes still parses once.
pub(super) struct LineReader {
    offset: u64,
    partial: Vec<u8>,
    /// The first line of the file (at most `HEAD_LEN` bytes) as last seen, or
    /// what there is of it while it is still being written.
    head: Vec<u8>,
}

impl LineReader {
    pub(super) fn new() -> Self {
        LineReader {
            offset: 0,
            partial: Vec::new(),
            head: Vec::new(),
        }
    }

    fn reset(&mut self) {
        self.offset = 0;
        self.partial.clear();
        self.head.clear();
    }

    /// Whether the file still starts with the bytes it started with.
    fn head_matches(&self, file: &mut std::fs::File) -> bool {
        let mut now = vec![0; self.head.len()];
        file.seek(SeekFrom::Start(0)).is_ok()
            && file.read_exact(&mut now).is_ok()
            && now == self.head
    }

    /// Up to `READ_CHUNK` bytes of what was appended since the last call, as
    /// complete lines. A file that shrank, or grew but no longer begins with
    /// the bytes it began with, is a rewrite: the reader restarts at 0.
    pub(super) fn read_new(&mut self, path: &Path) -> ReadBatch {
        let Ok(meta) = std::fs::metadata(path) else {
            return ReadBatch::nothing(false);
        };
        let len = meta.len();
        let mut rewound = len < self.offset;
        if rewound {
            self.reset();
        }
        if len == self.offset {
            return ReadBatch::nothing(rewound);
        }

        let Ok(mut file) = std::fs::File::open(path) else {
            return ReadBatch::nothing(rewound);
        };
        if self.offset > 0 && !self.head_matches(&mut file) {
            self.reset();
            rewound = true;
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return ReadBatch::nothing(rewound);
        }
        let Ok(read) = file
            .by_ref()
            .take(READ_CHUNK)
            .read_to_end(&mut self.partial)
        else {
            return ReadBatch::nothing(rewound);
        };
        self.offset += read as u64;
        if self.head.len() < HEAD_LEN && !self.head.contains(&b'\n') {
            self.remember_head(&mut file);
        }

        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(pos) = self.partial[start..].iter().position(|b| *b == b'\n') {
            let end = start + pos;
            lines.push(String::from_utf8_lossy(&self.partial[start..end]).into_owned());
            start = end + 1;
        }
        self.partial.drain(..start);
        ReadBatch {
            lines,
            rewound,
            more: self.offset < len,
        }
    }

    fn remember_head(&mut self, file: &mut std::fs::File) {
        let mut head = Vec::with_capacity(HEAD_LEN);
        if file.seek(SeekFrom::Start(0)).is_ok()
            && file
                .by_ref()
                .take(HEAD_LEN as u64)
                .read_to_end(&mut head)
                .is_ok()
        {
            if let Some(newline) = head.iter().position(|b| *b == b'\n') {
                head.truncate(newline + 1);
            }
            self.head = head;
        }
    }
}

// ── Subagent transcripts ──────────────────────────────────────────────────────

/// Counts `tool_use` blocks in one subagent's own transcript, and keeps its
/// requests so their usage reaches the session's totals.
///
/// Subagent turns are not written into the parent file — every line there is
/// `isSidechain: false`. Each `Agent` call gets
/// `<dir>/<session uuid>/subagents/agent-<id>.jsonl` plus a sibling
/// `agent-<id>.meta.json` whose `toolUseId` is the parent's `tool_use` id.
struct SubagentCounter {
    reader: LineReader,
    tool_count: u32,
    /// requestId -> usage, deduplicated the same way as the parent's.
    requests: HashMap<String, ReqData>,
}

impl SubagentCounter {
    fn new() -> Self {
        SubagentCounter {
            reader: LineReader::new(),
            tool_count: 0,
            requests: HashMap::new(),
        }
    }

    /// Returns true when the count or the usage changed.
    fn poll(&mut self, path: &Path) -> bool {
        let before = (self.tool_count, self.requests.len());
        let mut changed = false;
        loop {
            let batch = self.reader.read_new(path);
            if batch.rewound {
                self.tool_count = 0;
                self.requests.clear();
                changed = true;
            }
            for raw in &batch.lines {
                let Ok(obj) = serde_json::from_str::<Value>(raw) else {
                    continue;
                };
                if line_type(&obj) != "assistant" {
                    continue;
                }
                let msg = obj.get("message").unwrap_or(&Value::Null);
                self.tool_count += tool_uses(msg).len() as u32;
                if let (Some(model), Some(key)) = (assistant_model(&obj), request_key(&obj)) {
                    self.requests
                        .entry(key)
                        .or_insert_with(|| ReqData::from_message(model, msg));
                }
            }
            if !batch.more {
                break;
            }
        }
        changed || (self.tool_count, self.requests.len()) != before
    }
}

// ── The tail ──────────────────────────────────────────────────────────────────

/// One session's transcript tail plus the state folded out of it.
pub struct SessionTail {
    path: PathBuf,
    /// `<transcript dir>/<session uuid>/subagents`.
    subagents_dir: PathBuf,
    /// `<transcript dir>/<session uuid>/workflows`.
    workflows_dir: PathBuf,
    reader: LineReader,
    session: LiveSession,
    /// requestId -> usage, so lines sharing a request are counted once.
    requests: HashMap<String, ReqData>,
    /// Key into `requests` of the newest request seen. The map has no order, and
    /// current context is the newest request's, not the biggest.
    last_request: Option<String>,
    /// Unanswered `tool_use` blocks in call order: (id, name, input summary).
    outstanding: Vec<(String, String, String)>,
    /// `tool_use` id -> index into `session.subagents`.
    subagent_index: HashMap<String, usize>,
    /// Subagent file stem -> its incremental tool counter.
    subagent_files: HashMap<String, SubagentCounter>,
    /// Indices into `session.subagents` of the ones launched in the background.
    background_subagents: HashSet<usize>,
    /// Workflow run file -> (len, mtime) at the last poll. Claude Code rewrites
    /// `wf_<runId>.json` whole rather than appending to it, so there is no
    /// offset to advance and `LineReader` does not apply — the file is re-read
    /// and re-parsed when this marker moves.
    workflow_files: HashMap<PathBuf, (u64, Option<std::time::SystemTime>)>,
    /// `"<runId>/<agentId>"` -> index into `session.subagents`, so a re-read
    /// replaces the row it already contributed. Deliberately separate from
    /// `subagent_index`: workflow agents are an independent source feeding the
    /// same Vec, and the `Task`/`Agent` path never sees them.
    workflow_agent_index: HashMap<String, usize>,
    /// Whether a `pendingBackgroundAgentCount` has ever been seen — see `fold_system`.
    seen_background_count: bool,
    /// `stop_reason` of the newest assistant line.
    last_stop_reason: Option<String>,
    /// Line currently displayed as `Working`, and the role it really has.
    working: Option<(usize, LineRole)>,
    /// Lines that were not JSON. Counted so a format change is logged once
    /// instead of every line silently vanishing.
    skipped_lines: u64,
}

impl SessionTail {
    pub fn new(session_uuid: String, path: PathBuf) -> Self {
        let subagents_dir = path
            .parent()
            .map(|p| p.join(&session_uuid).join("subagents"))
            .unwrap_or_else(|| PathBuf::from("subagents"));
        let workflows_dir = path
            .parent()
            .map(|p| p.join(&session_uuid).join("workflows"))
            .unwrap_or_else(|| PathBuf::from("workflows"));
        SessionTail {
            path,
            subagents_dir,
            workflows_dir,
            reader: LineReader::new(),
            session: LiveSession::new(session_uuid),
            requests: HashMap::new(),
            last_request: None,
            outstanding: Vec::new(),
            subagent_index: HashMap::new(),
            subagent_files: HashMap::new(),
            background_subagents: HashSet::new(),
            workflow_files: HashMap::new(),
            workflow_agent_index: HashMap::new(),
            seen_background_count: false,
            last_stop_reason: None,
            working: None,
            skipped_lines: 0,
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
        let mut read_anything = false;
        loop {
            let batch = self.reader.read_new(&self.path);
            if batch.rewound {
                self.rebuild();
                read_anything = true;
            }
            read_anything |= !batch.lines.is_empty();
            for raw in &batch.lines {
                self.fold(raw);
            }
            if !batch.more {
                break;
            }
        }
        // After folding: a subagent is only tracked once its `Agent` call is read.
        let counts_changed = self.poll_subagents();
        let workflow_changed = self.poll_workflow_agents();
        let subagents_changed = counts_changed || workflow_changed;
        if !read_anything && !subagents_changed {
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
        self.last_request = None;
        self.outstanding.clear();
        self.subagent_index.clear();
        self.subagent_files.clear();
        self.background_subagents.clear();
        self.workflow_files.clear();
        self.workflow_agent_index.clear();
        self.seen_background_count = false;
        self.last_stop_reason = None;
        self.working = None;
    }

    fn fold(&mut self, raw: &str) {
        let Ok(obj) = serde_json::from_str::<Value>(raw) else {
            if !raw.trim().is_empty() {
                if self.skipped_lines == 0 {
                    log::warn!(
                        "{}: skipping a line that is not JSON (later ones are not logged)",
                        self.path.display()
                    );
                }
                self.skipped_lines += 1;
            }
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
            "system" => self.fold_system(&obj, timestamp),
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
            let text: &str = &text;
            // How a background subagent reports that it stopped. Read before the
            // early return, because a notification arrives as plain user text
            // rather than as the `tool_result` of the call that spawned it.
            // The status tells `completed` from `failed`; Atlas shows a finished
            // subagent the same either way, so only the id is acted on.
            if let Some((tool_use_id, _status)) = task_notification(text) {
                if let Some(&idx) = self.subagent_index.get(tool_use_id) {
                    self.finish_subagent(idx, timestamp.clone());
                }
            }
            // `/clear` wipes what Claude Code sends the model, but it is a local
            // command with no assistant reply of its own — nothing else in the
            // transcript says the window emptied until the next request lands.
            // Reacting to the command line itself keeps `context_tokens` in step
            // with Claude Code's own status line, which drops the moment `/clear`
            // runs rather than staying at its pre-clear value until then.
            if is_clear_command(text) {
                self.last_request = None;
            }
            if !is_meta {
                // A notification or local command is plumbing, not something
                // said — the card's feed shows the prompt the user typed.
                if let Some(prompt) = prompt_text(text) {
                    // A typed prompt (image-bearing ones included) starts a turn
                    // the model has not answered yet, so the previous turn's
                    // `end_turn` no longer describes the session, and a tool call
                    // still unanswered from before it never will be: Claude Code
                    // does not always write a result for a call killed mid-run.
                    // A slash command may be handled locally with no reply at all,
                    // so it leaves the state alone.
                    if tagged(text, "command-name").is_none() {
                        self.last_stop_reason = None;
                        self.outstanding.clear();
                    }
                    self.push_line(LineRole::User, format!("> {}", prompt), timestamp);
                    self.session.last_prompt = Some(prompt);
                    self.session.last_reply = None;
                    self.session.turn_ended_at = None;
                    self.session.turn_duration_ms = None;
                }
            }
            return;
        }
        // `toolUseResult` describes the line's single `tool_result` block. An
        // async launch reports `isAsync: true` — see `is_async_launch`.
        let async_launch = is_async_launch(obj);
        for result in tool_results(obj) {
            self.outstanding
                .retain(|(id, _, _)| id != result.tool_use_id);
            if let Some(&idx) = self.subagent_index.get(result.tool_use_id) {
                // A background spawn's result is a launch receipt, not a
                // completion: it lands seconds in while the agent runs for
                // minutes. Only its task-notification ends it. A synchronous
                // subagent — and a background one that failed to launch, which
                // reports an ordinary error result — is done here as before.
                if async_launch {
                    self.background_subagents.insert(idx);
                } else {
                    self.finish_subagent(idx, timestamp.clone());
                }
            }
            let role = if result.is_error {
                LineRole::Alert
            } else {
                LineRole::Tool
            };
            let text = format!("  {}", excerpt(&result_text(result.content)));
            self.push_line(role, text, timestamp.clone());
        }
    }

    fn fold_assistant(&mut self, obj: &Value, timestamp: Option<String>) {
        let msg = obj.get("message").unwrap_or(&Value::Null);
        if let Some(stop) = msg.get("stop_reason").and_then(|v| v.as_str()) {
            self.last_stop_reason = Some(stop.to_string());
            // The turn is over, so no call it made can still be running.
            if stop == "end_turn" {
                self.outstanding.clear();
            }
        }

        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            let mut texts: Vec<&str> = Vec::new();
            for block in content {
                // `thinking` blocks are deliberately not surfaced.
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                        if !text.trim().is_empty() {
                            self.push_line(LineRole::Note, note_text(text), timestamp.clone());
                            texts.push(text);
                        }
                    }
                }
            }
            if !texts.is_empty() {
                self.session.last_reply = Some(capped(texts.join("\n\n").trim(), REPLY_SUMMARY));
            }
        }

        let mut new_tools: Vec<String> = Vec::new();
        for tool in tool_uses(msg) {
            let summary = input_summary(tool.input);
            self.push_line(
                LineRole::Step,
                format!("* {} {}", tool.name, summary)
                    .trim_end()
                    .to_string(),
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
                    agent_type: Some(subagent_type(tool.input)),
                    started_at: timestamp.clone(),
                    finished_at: None,
                    tool_count: 0,
                    done: false,
                });
            }
        }

        // Usage is repeated on every line of a request — take it once.
        if let (Some(model), Some(key)) = (assistant_model(obj), request_key(obj)) {
            self.session.model = Some(model.to_string());
            self.last_request = Some(key.clone());
            let entry = self
                .requests
                .entry(key)
                .or_insert_with(|| ReqData::from_message(model, msg));
            entry.tool_names.extend(new_tools);
        }
    }

    /// `turn_duration` lines carry `pendingBackgroundAgentCount`, the CLI's own
    /// count of live background agents. Notifications alone already track it
    /// exactly, so this is only a backstop: it settles subagents whose
    /// notification can never arrive, such as ones still open when Claude Code
    /// was killed and later resumed.
    fn fold_system(&mut self, obj: &Value, timestamp: Option<String>) {
        if obj.get("subtype").and_then(|v| v.as_str()) != Some("turn_duration") {
            return;
        }
        self.session.turn_ended_at = timestamp.clone();
        self.session.turn_duration_ms = obj.get("durationMs").and_then(|v| v.as_u64());
        // The field is omitted rather than written as `0` when nothing is
        // pending, so an absent value only means zero once we have seen the
        // field at all — a Claude Code that never writes it must not settle
        // every subagent on every turn.
        match obj
            .get("pendingBackgroundAgentCount")
            .and_then(|v| v.as_u64())
        {
            Some(count) => {
                self.seen_background_count = true;
                if count == 0 {
                    self.settle_background(timestamp);
                }
            }
            None if self.seen_background_count => self.settle_background(timestamp),
            None => {}
        }
    }

    /// No background agent is live, so none of ours can still be running.
    fn settle_background(&mut self, at: Option<String>) {
        let open: Vec<usize> = self.background_subagents.iter().copied().collect();
        for idx in open {
            self.finish_subagent(idx, at.clone());
        }
    }

    /// Mark a subagent finished, keeping the first finish. A background agent
    /// notifies again if the user resumes it, and re-finishing would move the
    /// recorded end past the work it actually describes.
    fn finish_subagent(&mut self, idx: usize, at: Option<String>) {
        let agent = &mut self.session.subagents[idx];
        if agent.done {
            return;
        }
        agent.done = true;
        agent.finished_at = at;
    }

    fn push_line(&mut self, role: LineRole, text: String, timestamp: Option<String>) {
        self.session.lines.push(TranscriptLine {
            role,
            text,
            timestamp,
        });
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
        // A subagent's requests are billed to this session but never written
        // into its transcript. Spend only: its context and tools are its own.
        for req in self
            .subagent_files
            .values()
            .flat_map(|c| c.requests.values())
        {
            output_tokens += req.output_tokens;
            cost_estimate += req.cost();
        }
        // Newest request, not biggest: after a compact or a `/clear` the window
        // really is emptier, and a peak would stay pinned to the old high while
        // Claude Code's own status line counts back up from the bottom.
        let context_tokens = self
            .last_request
            .as_ref()
            .and_then(|key| self.requests.get(key))
            .map(|req| req.context() + req.output_tokens)
            .unwrap_or(0);

        self.session.output_tokens = output_tokens;
        self.session.cost_estimate = cost_estimate;
        self.session.context_tokens = context_tokens;
        self.session.peak_context = peak_context;
        self.session.tool_calls = tool_calls;
        self.session.context_pct =
            context_pct(context_tokens, self.session.model.as_deref().unwrap_or(""));

        // The oldest unanswered call is the one actually blocking.
        self.session.pending_tool =
            self.outstanding
                .first()
                .map(|(_, name, summary)| PendingTool {
                    name: name.clone(),
                    input_summary: summary.clone(),
                });

        // A background subagent keeps the session running with nothing
        // outstanding and the turn ended, because the work is happening in
        // another process that this transcript only hears from on completion.
        let subagent_running = self.session.subagents.iter().any(|s| !s.done);

        // Only the two states a transcript can tell apart. `NeedsYou` and
        // `Error` never come from here at all — see `SessionState`.
        self.session.state = if self.session.pending_tool.is_none()
            && !subagent_running
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

    /// Fold in the agents of every workflow run whose file has changed.
    ///
    /// The `Workflow` tool spawns agents that never appear as `Task`/`Agent`
    /// `tool_use` blocks in the parent transcript, so
    /// `<session uuid>/workflows/wf_<runId>.json` is the only record of them.
    fn poll_workflow_agents(&mut self) -> bool {
        let Ok(entries) = std::fs::read_dir(&self.workflows_dir) else {
            return false;
        };
        let mut changed = false;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            let marker = (meta.len(), meta.modified().ok());
            if self.workflow_files.get(&path) == Some(&marker) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(run) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            self.workflow_files.insert(path.clone(), marker);
            for (key, agent) in workflow_agents(&run) {
                if let Some(&idx) = self.workflow_agent_index.get(&key) {
                    self.session.subagents[idx] = agent;
                } else {
                    self.workflow_agent_index
                        .insert(key, self.session.subagents.len());
                    self.session.subagents.push(agent);
                }
            }
            changed = true;
        }
        changed
    }
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

/// One line, trimmed and capped — transcript text is multi-line and long.
pub(super) fn excerpt(text: &str) -> String {
    let first = text.trim().lines().next().unwrap_or("").trim();
    if first.chars().count() <= EXCERPT {
        return first.to_string();
    }
    let cut: String = first.chars().take(EXCERPT).collect();
    format!("{}…", cut)
}

/// `text` capped at `max` chars, with an ellipsis marking the cut.
pub(super) fn capped(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    format!("{}…", cut)
}

/// An assistant text block as one transcript line: whitespace collapsed and
/// capped, so the feed can clamp it to a few lines rather than the first.
pub(super) fn note_text(text: &str) -> String {
    capped(
        &text.split_whitespace().collect::<Vec<_>>().join(" "),
        NOTE_SUMMARY,
    )
}

/// The newest user prompt, for the Sessions grid card. None for a
/// `<task-notification>` or a local slash command; a `<command-name>` is
/// rendered as the slash command it names.
pub(super) fn prompt_text(text: &str) -> Option<String> {
    if task_notification(text).is_some() || text.trim_start().starts_with("<local-command-") {
        return None;
    }
    let base = if let Some(name) = tagged(text, "command-name") {
        format!("{} {}", name, tagged(text, "command-args").unwrap_or(""))
    } else {
        text.to_string()
    };
    let collapsed = base.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else {
        Some(capped(&collapsed, PROMPT_SUMMARY))
    }
}

/// `tool_result.content` is usually a string but can be an array of blocks.
pub(super) fn result_text(content: &Value) -> String {
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
pub(super) fn input_summary(input: &Value) -> String {
    for key in [
        "command",
        "file_path",
        "path",
        "pattern",
        "description",
        "url",
        "prompt",
    ] {
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

/// True when this `user` line's `tool_result` is a background agent's launch
/// receipt rather than its outcome.
///
/// `toolUseResult` is structured sidecar data on the line itself, so this is
/// decided where the result is folded — not from the sidecar `meta.json`'s
/// `requestShape`, which is written by another process and need not exist yet
/// when the receipt lands, nor by matching the receipt's prose. Claude Code
/// writes at most one `tool_result` per user line, so the object is unambiguous.
fn is_async_launch(obj: &Value) -> bool {
    obj.get("toolUseResult")
        .and_then(|r| r.get("isAsync"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// The `<tool-use-id>` and `<status>` of a `<task-notification>`, which is how a
/// background subagent reports that it stopped — minutes after the launch
/// receipt. None for ordinary user text.
///
/// Every notification means the agent stopped, so any status ends it; the two
/// seen in practice are `completed` and `failed`, which Atlas does not yet show
/// apart. The same task-id may notify more than once if the user resumes it,
/// and `done` is only ever set, never cleared.
fn task_notification(text: &str) -> Option<(&str, &str)> {
    if !text.contains("<task-notification>") {
        return None;
    }
    Some((tagged(text, "tool-use-id")?, tagged(text, "status")?))
}

/// Whether `text` is the `/clear` slash command line Claude Code writes when
/// the user runs it — a plain-string user line, not a `<task-notification>` or
/// a typed message.
fn is_clear_command(text: &str) -> bool {
    text.contains("<command-name>/clear</command-name>")
}

/// The contents of the first `<tag>…</tag>` in `text`.
fn tagged<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let rest = &text[text.find(&format!("<{}>", tag))? + tag.len() + 2..];
    Some(rest[..rest.find(&format!("</{}>", tag))?].trim())
}

/// The `Agent`/`Task` tool's `subagent_type`, `general-purpose` when omitted.
fn subagent_type(input: &Value) -> String {
    input
        .get("subagent_type")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("general-purpose")
        .to_string()
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

/// Workflow files timestamp in epoch milliseconds; every other timestamp in
/// this module is the transcript's own ISO-8601, which the frontend parses
/// with `Date.parse`. Convert at the boundary so `Subagent` only ever carries
/// one format.
pub(super) fn iso_from_epoch_ms(ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

fn workflow_task(entry: &Value) -> String {
    for key in ["label", "phaseTitle", "agentType"] {
        if let Some(value) = entry.get(key).and_then(|v| v.as_str()) {
            if !value.trim().is_empty() {
                return excerpt(value);
            }
        }
    }
    "Workflow agent".to_string()
}

/// The `workflow_agent` rows of one `wf_<runId>.json`, each keyed
/// `"<runId>/<agentId>"` so a re-read updates the row it already contributed
/// rather than pushing a duplicate.
fn workflow_agents(run: &Value) -> Vec<(String, Subagent)> {
    let run_id = run["runId"].as_str().unwrap_or("wf");
    let run_over = matches!(
        run.get("status").and_then(|v| v.as_str()),
        Some("completed") | Some("killed")
    );

    run["workflowProgress"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry.get("type").and_then(|v| v.as_str()) == Some("workflow_agent"))
        .map(|(i, entry)| {
            let key = format!(
                "{}/{}",
                run_id,
                entry["agentId"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("#{}", i))
            );
            let state = entry["state"].as_str().unwrap_or("");
            let done = run_over || !matches!(state, "progress" | "queued");

            let started_at_ms = entry["startedAt"]
                .as_i64()
                .or_else(|| entry["queuedAt"].as_i64());
            let started_at = started_at_ms.and_then(iso_from_epoch_ms);

            let finished_at = if !done {
                None
            } else {
                entry["lastProgressAt"]
                    .as_i64()
                    .and_then(iso_from_epoch_ms)
                    .or_else(|| {
                        started_at_ms.and_then(|start| {
                            iso_from_epoch_ms(
                                start.saturating_add(entry["durationMs"].as_i64().unwrap_or(0)),
                            )
                        })
                    })
            };

            let tool_count =
                u32::try_from(entry["toolCalls"].as_u64().unwrap_or(0)).unwrap_or(u32::MAX);

            let agent_type = entry["agentType"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            (
                key,
                Subagent {
                    task: workflow_task(entry),
                    agent_type,
                    started_at,
                    finished_at,
                    tool_count,
                    done,
                },
            )
        })
        .collect()
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

    /// A `task-notification` for each of the three background `Agent` calls the
    /// fixture opens and never closes. Only these end them: their `tool_result`
    /// is an async launch receipt.
    fn fixture_agents_notifying() -> Vec<String> {
        [
            "toolu_0118gcjuEJRTUbeqtJT9woYv",
            "toolu_01CPyBJGgy5geBUQg4ut8sq2",
            "toolu_01RW4z7xMj3W9N6nq9JqidXa",
        ]
        .iter()
        .map(|id| {
            let text = format!(
                "<task-notification>\\n<tool-use-id>{}</tool-use-id>\\n\
                 <status>completed</status>\\n</task-notification>",
                id
            );
            format!(
                r#"{{"type":"user","message":{{"role":"user","content":"{}"}},"timestamp":"2026-09-07T21:50:59.000Z"}}"#,
                text
            )
        })
        .collect()
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
            naive_output += obj["message"]["usage"]["output_tokens"]
                .as_u64()
                .unwrap_or(0);
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

    /// One assistant line carrying the usage of a request that read `cache_read`
    /// tokens of context and wrote `output` tokens back.
    fn usage_line(id: &str, cache_read: u64, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","requestId":"{id}","timestamp":"2026-09-07T21:50:59.000Z",
            "message":{{"role":"assistant","model":"claude-opus-5","stop_reason":"end_turn",
            "content":[{{"type":"text","text":"ok"}}],
            "usage":{{"input_tokens":10,"cache_read_input_tokens":{cache_read},
            "cache_creation_input_tokens":0,"output_tokens":{output}}}}}}}"#
        )
        .replace('\n', "")
    }

    #[test]
    fn context_follows_the_newest_request_while_peak_keeps_the_high_water_mark() {
        // The middle request is the biggest; the last one is what the window
        // actually holds, because a compact dropped it back down.
        let lines = vec![
            usage_line("req_a", 50_000, 200),
            usage_line("req_b", 143_000, 500),
            usage_line("req_c", 60_000, 300),
        ];
        let (_dir, mut tail) = tail_with(&lines);
        assert!(tail.poll());

        assert_eq!(tail.session().context_tokens, 10 + 60_000 + 300);
        assert_eq!(tail.session().peak_context, 10 + 143_000);
        // The percentage comes off the live number, not the peak.
        assert!((tail.session().context_pct - 60_310.0 / 1_000_000.0).abs() < 1e-12);
    }

    #[test]
    fn clear_command_drops_context_to_zero_without_waiting_for_a_reply() {
        // `/clear` itself carries no usage — nothing else says the window
        // emptied until the next request lands, which may be a while.
        let clear_line = r#"{"type":"user","timestamp":"2026-09-07T21:50:59.000Z",
            "message":{"role":"user","content":"<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>"}}"#
            .replace('\n', "");
        let lines = vec![usage_line("req_a", 143_000, 500), clear_line];
        let (_dir, mut tail) = tail_with(&lines);
        assert!(tail.poll());

        assert_eq!(tail.session().context_tokens, 0);
        assert_eq!(tail.session().context_pct, 0.0);
        // The pre-clear high water mark is still worth keeping around.
        assert_eq!(tail.session().peak_context, 10 + 143_000);
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
        let pending = tail
            .session()
            .pending_tool
            .as_ref()
            .expect("last call is unanswered");
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
    fn agent_calls_carry_their_subagent_type_defaulting_to_general_purpose() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        let agent = tail
            .session()
            .subagents
            .iter()
            .find(|s| s.task == "Check the parser")
            .expect("the fixture spawns this agent");
        assert_eq!(agent.agent_type, Some("Explore".to_string()));

        let inline = r#"{"type":"assistant","requestId":"req_inline","message":{"model":"claude-opus-5","content":[{"type":"tool_use","id":"toolu_inline1","name":"Agent","input":{"description":"No type"}}]},"timestamp":"2026-09-07T21:50:00.000Z"}"#.to_string();
        let (_dir2, mut tail2) = tail_with(&[inline]);
        tail2.poll();
        assert_eq!(
            tail2.session().subagents[0].agent_type,
            Some("general-purpose".to_string())
        );
    }

    #[test]
    fn agent_calls_become_subagents_and_a_synchronous_result_marks_one_done() {
        let (_dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        let subagents = &tail.session().subagents;
        assert!(!subagents.is_empty(), "the fixture spawns subagents");
        assert!(
            subagents
                .iter()
                .any(|s| s.task == "Check the parser" && s.done),
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
        assert!(
            tail.requests.len() > requests_after_first,
            "new requests folded in"
        );
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

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        write!(file, "{}", head).unwrap();
        drop(file);
        assert!(!tail.poll(), "a partial line yields nothing yet");
        assert!(tail.session().lines.is_empty());

        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
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
    fn subagent_tool_counts_and_spend_come_from_the_subagent_transcript() {
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

        let parent_only = {
            let (_d, mut t) = tail_with(&all);
            t.poll();
            t.session().output_tokens
        };
        tail.poll();
        let agent = tail
            .session()
            .subagents
            .iter()
            .find(|s| s.task == "Check the parser")
            .expect("the Agent call is tracked");
        assert_eq!(agent.tool_count, 2);

        // Regression: the tile showed the parent's spend alone, while Stats
        // already folded the subagent files in.
        let record =
            crate::commands::stats::parse_session(&dir.path().join(format!("{}.jsonl", UUID)))
                .unwrap();
        assert_eq!(tail.session().output_tokens, parent_only + 10);
        assert_eq!(tail.session().output_tokens, record.output_tokens);
        assert!((tail.session().cost_estimate - record.cost_estimate).abs() < 1e-9);
    }

    #[test]
    fn the_last_line_is_marked_working_only_while_running() {
        let (dir, mut tail) = tail_with(&fixture_lines());
        tail.poll();
        assert_eq!(tail.session().state, SessionState::Running);
        let last = tail.session().lines.last().unwrap();
        assert_eq!(last.role, LineRole::Working);

        // Answer the pending call and end the turn — the marker is withdrawn and
        // the line it borrowed gets its real role back. The fixture also opens
        // three background agents, and they keep the session running until each
        // one's task-notification arrives.
        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(&path, &fixture_agents_notifying());
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
            !tail
                .session()
                .lines
                .iter()
                .any(|l| l.role == LineRole::Working),
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

    // ── Background subagents ─────────────────────────────────────────────────

    /// Six real lines from a transcript that spawned 11 background agents, in
    /// file order, paths scrubbed: the `Agent` call, its async launch receipt,
    /// the `end_turn` that follows it, a `turn_duration` claiming one agent is
    /// pending, that agent's `task-notification`, and a later `turn_duration`
    /// that omits the count because none are left.
    const BG_FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/background-subagent.jsonl"
    );

    /// The `Agent` call's id and description in `BG_FIXTURE`.
    const BG_ID: &str = "toolu_01V7H7Jwyq2aDAk2BcmVQGra";
    const BG_TASK: &str = "Phase 01 — sessions rename";

    fn bg_lines() -> Vec<String> {
        std::fs::read_to_string(BG_FIXTURE)
            .expect("fixture is checked in")
            .lines()
            .map(|l| l.to_string())
            .collect()
    }

    /// Indices into `bg_lines()`, named so the tests read as a timeline.
    const SPAWN: usize = 0;
    const RECEIPT: usize = 1;
    const END_TURN: usize = 2;
    const COUNT_ONE: usize = 3;
    const NOTIFICATION: usize = 4;
    const COUNT_NONE: usize = 5;

    fn live_subagents(tail: &SessionTail) -> usize {
        tail.session().subagents.iter().filter(|a| !a.done).count()
    }

    #[test]
    fn the_background_fixture_is_the_timeline_the_tests_name() {
        let lines = bg_lines();
        assert_eq!(lines.len(), 6);
        assert!(lines[SPAWN].contains(BG_ID) && lines[SPAWN].contains(r#""name":"Agent""#));
        assert!(lines[RECEIPT].contains(r#""isAsync":true"#));
        assert!(lines[END_TURN].contains(r#""stop_reason":"end_turn""#));
        assert!(lines[COUNT_ONE].contains(r#""pendingBackgroundAgentCount":1"#));
        assert!(lines[NOTIFICATION].contains("<task-notification>"));
        assert!(!lines[COUNT_NONE].contains("pendingBackgroundAgentCount"));
        for needle in ["C:", "E:", "/Users/", "GitHub"] {
            assert!(
                !lines.iter().any(|l| l.contains(needle)),
                "the fixture leaks a real path ({needle})"
            );
        }
    }

    /// The regression. The receipt lands 2.8s after the call while the agent
    /// runs for minutes, so treating it as a completion reported `Idle` with
    /// eleven agents still working.
    #[test]
    fn a_launch_receipt_does_not_finish_a_background_subagent() {
        let lines = bg_lines();
        let (_dir, mut tail) = tail_with(&lines[SPAWN..=END_TURN]);
        assert!(tail.poll());

        let agent = &tail.session().subagents[0];
        assert_eq!(agent.task, BG_TASK);
        assert!(!agent.done, "the receipt only says the agent launched");

        // Every condition that used to mean Idle holds — nothing outstanding
        // and the turn ended — and the session is still Running.
        assert!(tail.session().pending_tool.is_none());
        assert_eq!(tail.last_stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(tail.session().state, SessionState::Running);
    }

    #[test]
    fn a_task_notification_finishes_a_background_subagent() {
        let lines = bg_lines();
        let (dir, mut tail) = tail_with(&lines[SPAWN..=COUNT_ONE]);
        tail.poll();
        assert_eq!(live_subagents(&tail), 1);
        assert_eq!(tail.session().state, SessionState::Running);

        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(&path, &lines[NOTIFICATION..=NOTIFICATION]);
        assert!(tail.poll());
        assert!(tail.session().subagents[0].done, "the notification ends it");
        assert_eq!(tail.session().state, SessionState::Idle);
    }

    /// The rail shows a finished agent how long it took, so the end has to be
    /// recorded rather than measured against the clock.
    #[test]
    fn finishing_records_when_it_happened_and_keeps_the_first_one() {
        let lines = bg_lines();
        let (dir, mut tail) = tail_with(&lines[SPAWN..=COUNT_ONE]);
        tail.poll();
        assert!(
            tail.session().subagents[0].finished_at.is_none(),
            "still running"
        );

        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(&path, &lines[NOTIFICATION..=NOTIFICATION]);
        tail.poll();
        let finished = tail.session().subagents[0].finished_at.clone();
        assert_eq!(finished.as_deref(), Some("2026-09-09T08:55:54.217Z"));

        // Resuming the agent notifies again; the first finish is the one that
        // describes the work, so a later notification must not move it.
        let again = lines[NOTIFICATION].replace("08:55:54.217Z", "09:44:00.000Z");
        append(&path, &[again]);
        tail.poll();
        assert_eq!(tail.session().subagents[0].finished_at, finished);
    }

    /// `pendingBackgroundAgentCount` is Claude Code's own count of live
    /// background agents, so agreeing with it is the check that the fold is
    /// right. It matches on all 24 of the source transcript's count lines.
    #[test]
    fn the_live_subagent_count_matches_the_count_the_cli_reports() {
        let lines = bg_lines();
        let (dir, mut tail) = tail_with(&lines[SPAWN..=COUNT_ONE]);
        tail.poll();
        assert_eq!(live_subagents(&tail), 1, "the CLI reports 1 pending here");

        // The field is omitted rather than zeroed once none are left.
        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(&path, &lines[NOTIFICATION..=COUNT_NONE]);
        tail.poll();
        assert_eq!(live_subagents(&tail), 0);
    }

    /// A notification can never arrive for an agent that was still open when
    /// Claude Code was killed, so the CLI's own count is the way out.
    #[test]
    fn a_subagent_whose_notification_never_arrives_is_settled_by_the_cli_count() {
        let lines = bg_lines();
        let (dir, mut tail) = tail_with(&lines[SPAWN..=COUNT_ONE]);
        tail.poll();
        assert_eq!(live_subagents(&tail), 1);

        // Straight to "none pending" with no notification in between.
        let path = dir.path().join(format!("{}.jsonl", UUID));
        append(&path, &lines[COUNT_NONE..=COUNT_NONE]);
        assert!(tail.poll());
        assert_eq!(live_subagents(&tail), 0);
        assert_eq!(tail.session().state, SessionState::Idle);
    }

    /// A Claude Code that never writes the count must not have every subagent
    /// settled by the absent field on every turn.
    #[test]
    fn an_absent_count_is_ignored_until_the_field_has_been_seen_once() {
        let lines = bg_lines();
        let mut timeline = lines[SPAWN..=END_TURN].to_vec();
        timeline.push(lines[COUNT_NONE].clone());
        let (_dir, mut tail) = tail_with(&timeline);
        tail.poll();
        assert_eq!(
            live_subagents(&tail),
            1,
            "an absent count means nothing before one has ever been written"
        );
        assert_eq!(tail.session().state, SessionState::Running);
    }

    #[test]
    fn tool_count_advances_for_a_subagent_that_is_still_running() {
        let lines = bg_lines();
        let (dir, mut tail) = tail_with(&lines[SPAWN..=COUNT_ONE]);

        let subagents = dir.path().join(UUID).join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        std::fs::write(
            subagents.join("agent-a64f02cb.meta.json"),
            format!(
                r#"{{"agentType":"general-purpose","description":"{}","toolUseId":"{}","requestShape":"background"}}"#,
                BG_TASK, BG_ID
            ),
        )
        .unwrap();
        std::fs::write(
            subagents.join("agent-a64f02cb.jsonl"),
            concat!(
                r#"{"type":"assistant","requestId":"r1","message":{"model":"claude-opus-5","content":[{"type":"tool_use","id":"s1","name":"Read","input":{}}]}}"#,
                "\n",
                r#"{"type":"assistant","requestId":"r2","message":{"model":"claude-opus-5","content":[{"type":"tool_use","id":"s2","name":"Edit","input":{}}]}}"#,
                "\n",
            ),
        )
        .unwrap();

        tail.poll();
        let agent = &tail.session().subagents[0];
        assert_eq!(agent.tool_count, 2);
        assert!(!agent.done, "it is still working while the count grows");
    }

    #[test]
    fn task_notification_reads_the_id_and_status_and_ignores_ordinary_text() {
        let notification = concat!(
            "<task-notification>\n<task-id>a1</task-id>\n",
            "<tool-use-id>toolu_9</tool-use-id>\n<status>completed</status>\n",
            "<summary>Agent finished</summary>\n</task-notification>",
        );
        assert_eq!(
            task_notification(notification),
            Some(("toolu_9", "completed"))
        );
        assert_eq!(
            task_notification("compare <status>x</status> in the docs"),
            None
        );
        assert_eq!(
            task_notification("<task-notification>\n<status>ok</status>"),
            None
        );
    }

    #[test]
    fn an_async_launch_is_read_off_the_lines_own_tool_use_result() {
        let receipt: Value = serde_json::from_str(&bg_lines()[RECEIPT]).unwrap();
        assert!(is_async_launch(&receipt));
        // Every ordinary tool result — and a background spawn that failed to
        // launch, which reports one — omits the flag.
        assert!(!is_async_launch(
            &serde_json::json!({"toolUseResult": {"stdout": ""}})
        ));
        assert!(!is_async_launch(&serde_json::json!({"type": "user"})));
    }

    // ── Workflow agents ──────────────────────────────────────────────────────

    /// Writes a `wf_test.json` into `<dir>/<uuid>/workflows/`, the way Claude
    /// Code lays out one workflow run's sidecar file.
    fn write_workflow(dir: &Path, uuid: &str, body: &str) {
        let workflows = dir.join(uuid).join("workflows");
        std::fs::create_dir_all(&workflows).unwrap();
        std::fs::write(workflows.join("wf_test.json"), body).unwrap();
    }

    /// One workflow run with a single `workflow_agent` row, differing only by
    /// `state` and whatever extra fields `extra` appends to that row.
    fn workflow_body(state: &str, extra: &str) -> String {
        format!(
            concat!(
                r#"{{"runId":"wf_test","workflowName":"test","status":"running","workflowProgress":["#,
                r#"{{"type":"workflow_phase","index":1,"title":"Implement"}},"#,
                r#"{{"type":"workflow_agent","agentId":"a668aa3f7b7f53893","label":"implement:add oldest-first sort","state":"{state}","startedAt":1790079889746,"toolCalls":42{extra}}}"#,
                r#"]}}"#,
            ),
            state = state,
            extra = extra,
        )
    }

    #[test]
    fn a_workflow_run_file_puts_its_agents_in_the_subagent_rail() {
        let (dir, mut tail) = tail_with(&[]);
        write_workflow(dir.path(), UUID, &workflow_body("progress", ""));

        assert!(tail.poll());
        let subagents = &tail.session().subagents;
        assert_eq!(subagents.len(), 1);
        let agent = &subagents[0];
        assert_eq!(agent.task, "implement:add oldest-first sort");
        assert!(!agent.done);
        assert!(agent.finished_at.is_none());
        assert_eq!(agent.tool_count, 42);
        assert_eq!(agent.started_at, iso_from_epoch_ms(1790079889746));
    }

    #[test]
    fn a_rewritten_workflow_file_updates_the_row_it_already_contributed() {
        let (dir, mut tail) = tail_with(&[]);
        write_workflow(dir.path(), UUID, &workflow_body("progress", ""));
        assert!(tail.poll());
        assert_eq!(tail.session().subagents.len(), 1);

        // The rewritten body must differ in byte length/mtime from the first
        // write for the change-detection to reliably fire in a fast test loop.
        write_workflow(
            dir.path(),
            UUID,
            &workflow_body(
                "done",
                ", \"lastProgressAt\":1790080308664,\"durationMs\":418917",
            ),
        );
        assert!(tail.poll());

        let subagents = &tail.session().subagents;
        assert_eq!(subagents.len(), 1, "the row is replaced, not duplicated");
        let agent = &subagents[0];
        assert!(agent.done);
        assert_eq!(agent.finished_at, iso_from_epoch_ms(1790080308664));
        assert_eq!(agent.tool_count, 42);
    }

    #[test]
    fn polling_an_unchanged_workflow_file_changes_nothing() {
        let (dir, mut tail) = tail_with(&[]);
        write_workflow(dir.path(), UUID, &workflow_body("progress", ""));
        assert!(tail.poll());

        assert!(!tail.poll(), "an unchanged run file yields no update");
        assert_eq!(tail.session().subagents.len(), 1);
    }

    #[test]
    fn epoch_millis_become_the_same_iso_stamp_the_transcript_writes() {
        let iso = iso_from_epoch_ms(1790079889746);
        assert!(iso.is_some());
        let iso = iso.unwrap();
        assert_eq!(iso.len(), 24, "YYYY-MM-DDTHH:MM:SS.sssZ is 24 chars: {iso}");
        assert!(iso.starts_with("2026-09-"), "unexpected date: {iso}");
        assert!(iso.ends_with(".746Z"), "millis must round-trip: {iso}");
        assert_eq!(&iso[4..5], "-");
        assert_eq!(&iso[10..11], "T");
    }

    #[test]
    fn workflow_agent_states_map_to_done_defensively() {
        let progress = serde_json::json!({"runId": "wf_1", "status": "running",
            "workflowProgress": [{"type": "workflow_agent", "agentId": "a1", "state": "progress", "startedAt": 1790079889746_i64}]});
        assert!(
            !workflow_agents(&progress)[0].1.done,
            "progress is not done"
        );

        let queued = serde_json::json!({"runId": "wf_1", "status": "running",
            "workflowProgress": [{"type": "workflow_agent", "agentId": "a1", "state": "queued", "queuedAt": 1790079889746_i64}]});
        assert!(!workflow_agents(&queued)[0].1.done, "queued is not done");

        let done = serde_json::json!({"runId": "wf_1", "status": "running",
            "workflowProgress": [{"type": "workflow_agent", "agentId": "a1", "state": "done",
                "startedAt": 1790079889746_i64, "lastProgressAt": 1790080308664_i64}]});
        let (_, agent) = &workflow_agents(&done)[0];
        assert!(agent.done, "done state is done");
        assert_eq!(agent.finished_at, iso_from_epoch_ms(1790080308664));

        let unknown_state = serde_json::json!({"runId": "wf_1", "status": "running",
            "workflowProgress": [{"type": "workflow_agent", "agentId": "a1", "state": "cancelled", "startedAt": 1790079889746_i64}]});
        assert!(
            workflow_agents(&unknown_state)[0].1.done,
            "an unrecognised state must not spin forever"
        );

        let killed_run = serde_json::json!({"runId": "wf_1", "status": "killed",
            "workflowProgress": [{"type": "workflow_agent", "agentId": "a1", "state": "progress", "startedAt": 1790079889746_i64}]});
        assert!(
            workflow_agents(&killed_run)[0].1.done,
            "a killed run finishes every agent regardless of its own state"
        );

        let no_label = serde_json::json!({"runId": "wf_1", "status": "running",
            "workflowProgress": [{"type": "workflow_agent", "agentId": "a1", "state": "progress",
                "agentType": "general-purpose", "startedAt": 1790079889746_i64}]});
        assert_eq!(workflow_agents(&no_label)[0].1.task, "general-purpose");
        assert_eq!(
            workflow_agents(&no_label)[0].1.agent_type,
            Some("general-purpose".to_string())
        );
    }

    // ── Session card summary ─────────────────────────────────────────────────

    #[test]
    fn prompt_and_reply_follow_the_newest_turn() {
        let first_ask = r#"{"type":"user","message":{"role":"user","content":"first ask"},"timestamp":"2026-09-07T21:50:00.000Z"}"#.to_string();
        let reply = r#"{"type":"assistant","requestId":"req_a","message":{"model":"claude-opus-5","content":[{"type":"text","text":"Done the thing.\n\nWant me to push?"}],"stop_reason":"end_turn","usage":{"output_tokens":10}},"timestamp":"2026-09-07T21:50:05.000Z"}"#.to_string();
        let (dir, mut tail) = tail_with(&[first_ask, reply]);
        assert!(tail.poll());

        assert_eq!(tail.session().last_prompt.as_deref(), Some("first ask"));
        assert_eq!(
            tail.session().last_reply.as_deref(),
            Some("Done the thing.\n\nWant me to push?")
        );

        let path = dir.path().join(format!("{}.jsonl", UUID));
        let second_ask = r#"{"type":"user","message":{"role":"user","content":"second ask"},"timestamp":"2026-09-07T21:50:10.000Z"}"#.to_string();
        append(&path, &[second_ask]);
        assert!(tail.poll());

        assert_eq!(tail.session().last_reply, None);
        assert_eq!(tail.session().last_prompt.as_deref(), Some("second ask"));
    }

    #[test]
    fn slash_commands_read_as_prompts_and_notifications_do_not() {
        let slash = r#"{"type":"user","message":{"role":"user","content":"<command-name>/model</command-name><command-args>opus</command-args>"},"timestamp":"2026-09-07T21:50:00.000Z"}"#.to_string();
        let (dir, mut tail) = tail_with(&[slash]);
        assert!(tail.poll());
        assert_eq!(tail.session().last_prompt.as_deref(), Some("/model opus"));

        let path = dir.path().join(format!("{}.jsonl", UUID));
        let notification = r#"{"type":"user","message":{"role":"user","content":"<task-notification>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n</task-notification>"},"timestamp":"2026-09-07T21:50:05.000Z"}"#.to_string();
        let meta = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"reminder text"},"timestamp":"2026-09-07T21:50:06.000Z"}"#.to_string();
        append(&path, &[notification, meta]);
        tail.poll();

        assert_eq!(tail.session().last_prompt.as_deref(), Some("/model opus"));
        let texts: Vec<&str> = tail
            .session()
            .lines
            .iter()
            .map(|l| l.text.as_str())
            .collect();
        assert_eq!(
            texts,
            ["> /model opus"],
            "the feed shows prompts, not plumbing"
        );
    }

    #[test]
    fn turn_duration_records_when_the_turn_ended_and_how_long_it_ran() {
        let line = r#"{"type":"system","subtype":"turn_duration","durationMs":77000,"timestamp":"2026-09-07T21:51:02.000Z"}"#.to_string();
        let (_dir, mut tail) = tail_with(&[line]);
        assert!(tail.poll());

        assert_eq!(
            tail.session().turn_ended_at.as_deref(),
            Some("2026-09-07T21:51:02.000Z")
        );
        assert_eq!(tail.session().turn_duration_ms, Some(77000));
    }

    #[test]
    fn a_long_prompt_is_collapsed_and_capped() {
        let long = format!("{}\n\n{}", "a".repeat(240), "b".repeat(260));
        let line = format!(
            r#"{{"type":"user","message":{{"role":"user","content":{}}},"timestamp":"2026-09-07T21:50:00.000Z"}}"#,
            serde_json::to_string(&long).unwrap()
        );
        let (_dir, mut tail) = tail_with(&[line]);
        assert!(tail.poll());

        let prompt = tail.session().last_prompt.clone().expect("prompt captured");
        assert!(!prompt.contains('\n'));
        assert_eq!(prompt.chars().count(), 401);
        assert!(prompt.ends_with('…'));
    }

    fn prompt_line(content: &str) -> String {
        format!(
            r#"{{"type":"user","message":{{"role":"user","content":{content}}},"timestamp":"2026-09-07T21:52:00.000Z"}}"#
        )
    }

    /// A prompt with a pasted image is written as an array of blocks, not a
    /// string. It is still the human's turn: it becomes the card's prompt and
    /// clears the previous reply.
    #[test]
    fn a_prompt_with_an_image_starts_a_new_turn() {
        let image_prompt = prompt_line(
            r#"[{"type":"text","text":"[Image #1] look at this"},{"type":"image","source":{}}]"#,
        );
        let (_dir, mut tail) = tail_with(&[usage_line("req_a", 1000, 10), image_prompt]);
        assert!(tail.poll());
        let session = tail.session();
        assert_eq!(
            session.last_prompt.as_deref(),
            Some("[Image #1] look at this")
        );
        assert_eq!(session.last_reply, None);
        assert_eq!(session.state, SessionState::Running);
    }

    #[test]
    fn an_interrupt_marker_is_not_a_prompt() {
        let interrupt = prompt_line(r#"[{"type":"text","text":"[Request interrupted by user]"}]"#);
        let (_dir, mut tail) = tail_with(&[interrupt]);
        tail.poll();
        assert_eq!(tail.session().last_prompt, None);
        assert!(tail.session().lines.is_empty());
    }

    /// Between the prompt landing and the first reply line the model is
    /// working, whatever the previous turn ended with.
    #[test]
    fn a_new_prompt_after_end_turn_is_running_not_idle() {
        let (_dir, mut tail) =
            tail_with(&[usage_line("req_a", 1000, 10), prompt_line(r#""next task""#)]);
        tail.poll();
        assert_eq!(tail.session().state, SessionState::Running);
    }

    /// Claude killed mid-tool leaves a `tool_use` with no `tool_result`. A
    /// later prompt and a finished turn must not keep the session blocked on it.
    #[test]
    fn a_tool_call_that_never_got_a_result_does_not_block_a_later_turn() {
        let orphan = r#"{"type":"assistant","requestId":"req_t","timestamp":"2026-09-07T21:50:00.000Z","message":{"role":"assistant","model":"claude-opus-5","stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"sleep 99"}}],"usage":{"output_tokens":5}}}"#.to_string();
        let (_dir, mut tail) = tail_with(&[
            orphan,
            prompt_line(r#""continue""#),
            usage_line("req_b", 1000, 10),
        ]);
        tail.poll();
        assert!(tail.session().pending_tool.is_none());
        assert_eq!(tail.session().state, SessionState::Idle);
    }

    /// Numbers come straight from a file another process writes. A corrupt
    /// line must not panic (debug) or wrap (release) the tail.
    #[test]
    fn absurd_usage_and_workflow_times_do_not_overflow() {
        let huge = format!(
            r#"{{"type":"assistant","requestId":"req_h","timestamp":"2026-09-07T21:50:59.000Z","message":{{"role":"assistant","model":"claude-opus-5","stop_reason":"end_turn","content":[{{"type":"text","text":"ok"}}],"usage":{{"input_tokens":1,"cache_read_input_tokens":{max},"cache_creation_input_tokens":{max},"output_tokens":{max}}}}}}}"#,
            max = u64::MAX
        );
        let (dir, mut tail) = tail_with(&[huge]);
        write_workflow(
            dir.path(),
            UUID,
            &format!(
                r#"{{"runId":"wf_test","status":"completed","workflowProgress":[{{"type":"workflow_agent","agentId":"a1","state":"done","startedAt":{},"durationMs":10,"toolCalls":{}}}]}}"#,
                i64::MAX - 1,
                u64::MAX
            ),
        );
        tail.poll();
        assert_eq!(tail.session().subagents[0].tool_count, u32::MAX);
    }

    /// A transcript resumed after a long session is read in bounded chunks;
    /// a line and a multibyte character straddling a chunk edge must survive.
    #[test]
    fn a_transcript_larger_than_a_chunk_is_read_in_full() {
        let filler = "é".repeat(500);
        let lines: Vec<String> = (0..3000)
            .map(|i| prompt_line(&format!("\"{i} {filler}\"")))
            .collect();
        let (dir, mut tail) = tail_with(&lines);

        let mut reader = LineReader::new();
        let first = reader.read_new(&dir.path().join(format!("{UUID}.jsonl")));
        assert!(first.more, "3 MiB is more than one chunk");
        assert!(first.lines.len() < lines.len());

        assert!(tail.poll());
        let prompt = tail.session().last_prompt.as_deref().unwrap();
        assert!(prompt.starts_with("2999 é"), "{prompt}");
    }

    /// A different file that grew past the old offset is not an append.
    #[test]
    fn a_replaced_larger_file_is_rebuilt_not_appended_to() {
        let shared = r#"{"parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/work/project","#;
        let first_line = |session: &str| {
            format!(
                r#"{shared}"sessionId":"{session}","type":"user","message":{{"role":"user","content":"{session} prompt"}}}}"#
            )
        };
        let (dir, mut tail) = tail_with(&[first_line("aaaaaaaa")]);
        tail.poll();
        assert_eq!(
            tail.session().last_prompt.as_deref(),
            Some("aaaaaaaa prompt")
        );

        let replacement: Vec<String> = ["bbbbbbbbbbbbbbbbbbbb"; 3]
            .iter()
            .map(|s| first_line(s))
            .collect();
        let path = dir.path().join(format!("{UUID}.jsonl"));
        std::fs::write(&path, replacement.join("\n") + "\n").unwrap();

        assert!(tail.poll());
        assert_eq!(
            tail.session().last_prompt.as_deref(),
            Some("bbbbbbbbbbbbbbbbbbbb prompt")
        );
        assert_eq!(tail.session().lines.len(), 3);
        assert!(
            tail.session().lines[0]
                .text
                .contains("bbbbbbbbbbbbbbbbbbbb"),
            "the old file's line must be gone: {:?}",
            tail.session().lines[0].text
        );
    }

    /// A writer killed mid-line leaves a fragment; the record written after
    /// the restart must still be read.
    #[test]
    fn a_torn_line_does_not_swallow_the_record_after_it() {
        let (dir, mut tail) = tail_with(&[]);
        let path = dir.path().join(format!("{UUID}.jsonl"));
        std::fs::write(&path, r#"{"type":"user","message":{"content":"a""#).unwrap();
        tail.poll();
        append(&path, &["".to_string(), prompt_line(r#""b""#)]);
        tail.poll();
        assert_eq!(tail.session().last_prompt.as_deref(), Some("b"));
    }
}
