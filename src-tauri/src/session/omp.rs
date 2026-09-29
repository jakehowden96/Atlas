//! Live per-session state for OMP, derived by tailing its own transcript
//! (`~/.omp/agent/sessions/<slug>/<uuid>.jsonl`) plus, for a `task` call's
//! subagents, `<uuid>/<name>.jsonl` beside it — mirroring `session::live` for
//! Claude Code.

use serde_json::Value;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::live::{
    capped, excerpt, input_summary, iso_from_epoch_ms, prompt_text, result_text, LineReader,
    LineRole, LiveSession, PendingTool, PlanItem, SessionState, Subagent, TranscriptLine,
    MAX_LINES, REPLY_SUMMARY,
};
use crate::commands::stats::SessionRecord;
use crate::transcript::{context_pct, model_family, ModelSessionData};

// ── Paths ────────────────────────────────────────────────────────────────────

/// `~/.omp/agent`. `PI_CODING_AGENT_DIR`/`XDG_STATE_HOME` overrides are not
/// read — this is where a default install writes.
pub fn agent_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".omp").join("agent"))
}

/// The breadcrumb file OMP writes for one terminal, keyed by its tty:
/// `/dev/ttys001` folds to `terminal-sessions/ttys001`.
pub fn breadcrumb_path(agent_dir: &Path, tty: &str) -> PathBuf {
    let key = tty.strip_prefix("/dev/").unwrap_or(tty).replace('/', "-");
    agent_dir.join("terminal-sessions").join(key)
}

/// The transcript path a breadcrumb names — its second line — or None if the
/// breadcrumb predates `since` (a stale file from an earlier terminal that
/// reused the same tty) or names nothing.
pub fn read_breadcrumb(path: &Path, since: SystemTime) -> Option<PathBuf> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    if modified < since {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let line = content.lines().nth(1)?.trim();
    if line.is_empty() {
        None
    } else {
        Some(PathBuf::from(line))
    }
}

// ── The tail ──────────────────────────────────────────────────────────────────

/// One OMP session's transcript tail plus the state folded out of it.
pub struct OmpTail {
    path: PathBuf,
    /// `<transcript path>` without its extension — the directory OMP writes
    /// each `task` subagent's own transcript into, `<name>.jsonl`.
    sidecar: PathBuf,
    reader: LineReader,
    /// Keyed by the Atlas session uuid, never OMP's own `session.id`.
    session: LiveSession,
    /// Unanswered `toolCall`s in call order: (id, name, input summary).
    outstanding: Vec<(String, String, String)>,
    /// `task`'s spawned-agent name -> index into `session.subagents`.
    subagent_index: HashMap<String, usize>,
    /// A `task` toolCall's id -> the indices it spawned, so an errored launch
    /// can finish every one of them.
    task_calls: HashMap<String, Vec<usize>>,
    /// Subagent name -> its own transcript's reader plus running tool count.
    subagent_files: HashMap<String, (LineReader, u32)>,
    /// `stopReason` of the newest assistant message.
    last_stop_reason: Option<String>,
    /// When the newest user prompt landed, so the closing assistant message
    /// can compute how long the turn took.
    prompt_at: Option<String>,
    /// Line currently displayed as `Working`, and the role it really has.
    working: Option<(usize, LineRole)>,
}

impl OmpTail {
    pub fn new(session_uuid: String, path: PathBuf) -> Self {
        let sidecar = path.with_extension("");
        OmpTail {
            path,
            sidecar,
            reader: LineReader::new(),
            session: LiveSession::new(session_uuid),
            outstanding: Vec::new(),
            subagent_index: HashMap::new(),
            task_calls: HashMap::new(),
            subagent_files: HashMap::new(),
            last_stop_reason: None,
            prompt_at: None,
            working: None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn session(&self) -> &LiveSession {
        &self.session
    }

    /// True for the transcript itself or one of its subagents' — a rewritten
    /// breadcrumb only ever names the parent file.
    pub fn owns(&self, path: &Path) -> bool {
        path == self.path || path.starts_with(&self.sidecar)
    }

    /// Fold in everything appended since the last call. Returns true when
    /// anything changed, i.e. when a `session-update` is worth emitting.
    pub fn poll(&mut self) -> bool {
        self.clear_working_marker();
        let (lines, rewound) = self.reader.read_new(&self.path);
        if rewound {
            self.rebuild();
        }
        for raw in &lines {
            self.fold(raw);
        }
        let subagents_changed = self.poll_subagent_files();
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
        self.outstanding.clear();
        self.subagent_index.clear();
        self.task_calls.clear();
        self.subagent_files.clear();
        self.last_stop_reason = None;
        self.prompt_at = None;
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

        match obj.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "title" | "title_change" => {
                if let Some(title) = obj.get("title").and_then(|v| v.as_str()) {
                    if !title.trim().is_empty() {
                        self.session.title = Some(title.to_string());
                    }
                }
            }
            "model_change" => {
                if self.session.model.is_none() {
                    if let Some(model) = obj.get("model").and_then(|v| v.as_str()) {
                        self.session.model = Some(after_last_slash(model));
                    }
                }
            }
            "message" => self.fold_message(&obj, timestamp),
            "custom_message" => self.fold_custom_message(&obj, timestamp),
            "custom" => self.fold_custom(&obj, timestamp),
            "reset_boundary" => {
                self.session.context_tokens = 0;
            }
            "compaction" => {
                self.session.context_tokens =
                    obj.get("tokensAfter").and_then(|v| v.as_u64()).unwrap_or(0);
            }
            _ => {}
        }
    }

    fn fold_message(&mut self, obj: &Value, timestamp: Option<String>) {
        let msg = obj.get("message").unwrap_or(&Value::Null);
        match msg.get("role").and_then(|v| v.as_str()) {
            Some("user") => self.fold_user(msg, timestamp),
            Some("assistant") => self.fold_assistant(msg, timestamp),
            Some("toolResult") => self.fold_tool_result(msg, timestamp),
            _ => {}
        }
    }

    fn fold_user(&mut self, msg: &Value, timestamp: Option<String>) {
        let text = text_blocks(msg.get("content").unwrap_or(&Value::Null));
        self.push_line(LineRole::User, format!("> {}", excerpt(&text)), timestamp.clone());

        let attribution = msg.get("attribution").and_then(|v| v.as_str());
        if attribution.is_none() || attribution == Some("user") {
            self.session.last_prompt = prompt_text(&text);
            self.session.last_reply = None;
            self.session.turn_ended_at = None;
            self.session.turn_duration_ms = None;
            self.prompt_at = timestamp;
            self.last_stop_reason = None;
        }
    }

    fn fold_assistant(&mut self, msg: &Value, timestamp: Option<String>) {
        if let Some(model) = msg.get("model").and_then(|v| v.as_str()) {
            self.session.model = Some(after_last_slash(model));
        }

        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            let mut texts: Vec<&str> = Vec::new();
            for block in content {
                if block.get("type").and_then(|v| v.as_str()) != Some("text") {
                    continue;
                }
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    if !text.trim().is_empty() {
                        self.push_line(LineRole::Note, excerpt(text), timestamp.clone());
                        texts.push(text);
                    }
                }
            }
            if !texts.is_empty() {
                self.session.last_reply = Some(capped(texts.join("\n\n").trim(), REPLY_SUMMARY));
            }

            for block in content {
                if block.get("type").and_then(|v| v.as_str()) != Some("toolCall") {
                    continue;
                }
                let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let arguments = block.get("arguments").unwrap_or(&Value::Null);
                let summary = tool_call_summary(arguments);

                self.push_line(
                    LineRole::Step,
                    format!("* {} {}", name, summary).trim_end().to_string(),
                    timestamp.clone(),
                );
                self.outstanding.push((id.clone(), name.clone(), summary));
                self.session.last_tool = Some(name.clone());
                self.session.tool_calls += 1;

                if name == "task" {
                    let mut spawned = Vec::new();
                    if let Some(tasks) = arguments.get("tasks").and_then(|v| v.as_array()) {
                        for entry in tasks {
                            let Some(task_name) = entry.get("name").and_then(|v| v.as_str())
                            else {
                                continue;
                            };
                            let idx = self.session.subagents.len();
                            self.session.subagents.push(Subagent {
                                task: task_label(entry),
                                agent_type: entry
                                    .get("agent")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string),
                                started_at: timestamp.clone(),
                                finished_at: None,
                                tool_count: 0,
                                done: false,
                            });
                            self.subagent_index.insert(task_name.to_string(), idx);
                            spawned.push(idx);
                        }
                    }
                    self.task_calls.insert(id, spawned);
                }
            }
        }

        if let Some(usage) = msg.get("usage") {
            let output = usage.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
            self.session.output_tokens += output;
            self.session.cost_estimate += usage
                .get("cost")
                .and_then(|c| c.get("total"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);

            let input = usage.get("input").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_read = usage.get("cacheRead").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_write = usage.get("cacheWrite").and_then(|v| v.as_u64()).unwrap_or(0);
            let ctx = input + cache_read + cache_write;
            if ctx > 0 {
                self.session.peak_context = self.session.peak_context.max(ctx);
                self.session.context_tokens = ctx + output;
            }
        }

        if let Some(stop) = msg.get("stopReason").and_then(|v| v.as_str()) {
            self.last_stop_reason = Some(stop.to_string());
            if stop != "toolUse" {
                self.session.turn_ended_at = timestamp.clone();
                self.session.turn_duration_ms = self.duration_since_prompt(timestamp.as_deref());
                if stop == "aborted" || stop == "error" {
                    self.outstanding.clear();
                }
            }
        }
    }

    fn fold_tool_result(&mut self, msg: &Value, timestamp: Option<String>) {
        let tool_call_id = msg
            .get("toolCallId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = msg.get("toolName").and_then(|v| v.as_str()).unwrap_or("");
        let is_error = msg.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);

        self.outstanding.retain(|(id, _, _)| id != &tool_call_id);

        let content = msg.get("content").unwrap_or(&Value::Null);
        let role = if is_error { LineRole::Alert } else { LineRole::Tool };
        self.push_line(role, format!("  {}", excerpt(&result_text(content))), timestamp.clone());

        if tool_name == "todo" && !is_error {
            let details = msg.get("details").unwrap_or(&Value::Null);
            let is_view = details.get("op").and_then(|v| v.as_str()) == Some("view");
            if !is_view {
                if let Some(phases) = details.get("phases").and_then(|v| v.as_array()) {
                    self.session.plan = plan_from_phases(phases);
                }
            }
        }

        if tool_name == "task" && is_error {
            if let Some(indices) = self.task_calls.get(&tool_call_id).cloned() {
                for idx in indices {
                    self.finish_subagent(idx, timestamp.clone());
                }
            }
        }
    }

    /// `stopReason != "toolUse"` closed the turn — how long it took since the
    /// prompt that opened it.
    fn duration_since_prompt(&self, ts: Option<&str>) -> Option<u64> {
        let end = chrono::DateTime::parse_from_rfc3339(ts?).ok()?;
        let start = chrono::DateTime::parse_from_rfc3339(self.prompt_at.as_deref()?).ok()?;
        u64::try_from((end - start).num_milliseconds()).ok()
    }

    fn fold_custom_message(&mut self, obj: &Value, timestamp: Option<String>) {
        if obj.get("customType").and_then(|v| v.as_str()) != Some("async-result") {
            return;
        }
        let Some(jobs) = obj.get("details").and_then(|d| d.get("jobs")).and_then(|v| v.as_array())
        else {
            return;
        };
        for job in jobs {
            let Some(job_id) = job.get("jobId").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(&idx) = self.subagent_index.get(job_id) else {
                continue;
            };
            let duration_ms = job.get("durationMs").and_then(|v| v.as_i64());
            let started_at = self.session.subagents[idx].started_at.clone();
            let finished_at = started_at
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .zip(duration_ms)
                .and_then(|(dt, dur)| iso_from_epoch_ms(dt.timestamp_millis() + dur))
                .or_else(|| timestamp.clone());
            self.finish_subagent(idx, finished_at);
        }
    }

    fn fold_custom(&mut self, obj: &Value, timestamp: Option<String>) {
        match obj.get("customType").and_then(|v| v.as_str()) {
            Some("session_exit") => {
                let open: Vec<usize> = (0..self.session.subagents.len())
                    .filter(|&i| !self.session.subagents[i].done)
                    .collect();
                for idx in open {
                    self.finish_subagent(idx, timestamp.clone());
                }
                self.outstanding.clear();
                self.last_stop_reason = Some("exit".to_string());
            }
            Some("user_todo_edit") => {
                if let Some(phases) =
                    obj.get("data").and_then(|d| d.get("phases")).and_then(|v| v.as_array())
                {
                    self.session.plan = plan_from_phases(phases);
                }
            }
            _ => {}
        }
    }

    /// Mark a subagent finished, keeping the first finish.
    fn finish_subagent(&mut self, idx: usize, at: Option<String>) {
        let agent = &mut self.session.subagents[idx];
        if agent.done {
            return;
        }
        agent.done = true;
        agent.finished_at = at;
    }

    fn push_line(&mut self, role: LineRole, text: String, timestamp: Option<String>) {
        self.session.lines.push(TranscriptLine { role, text, timestamp });
        if self.session.lines.len() > MAX_LINES {
            let overflow = self.session.lines.len() - MAX_LINES;
            self.session.lines.drain(..overflow);
        }
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

    /// Refresh `tool_count` for every subagent whose own transcript has grown,
    /// and finish the ones that yielded.
    fn poll_subagent_files(&mut self) -> bool {
        let mut changed = false;
        let entries: Vec<(String, usize)> =
            self.subagent_index.iter().map(|(name, &idx)| (name.clone(), idx)).collect();

        for (name, idx) in entries {
            let path = self.sidecar.join(format!("{}.jsonl", name));
            let (lines, rewound) = self
                .subagent_files
                .entry(name.clone())
                .or_insert_with(|| (LineReader::new(), 0))
                .0
                .read_new(&path);
            if rewound {
                self.subagent_files.get_mut(&name).unwrap().1 = 0;
            }
            if lines.is_empty() && !rewound {
                continue;
            }

            let mut tool_calls = 0u32;
            let mut finishes: Vec<Option<String>> = Vec::new();
            for raw in &lines {
                let Ok(obj) = serde_json::from_str::<Value>(raw) else {
                    continue;
                };
                if obj.get("type").and_then(|v| v.as_str()) != Some("message") {
                    continue;
                }
                let msg = obj.get("message").unwrap_or(&Value::Null);
                match msg.get("role").and_then(|v| v.as_str()) {
                    Some("assistant") => {
                        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
                            tool_calls += content
                                .iter()
                                .filter(|b| {
                                    b.get("type").and_then(|v| v.as_str()) == Some("toolCall")
                                })
                                .count() as u32;
                        }
                    }
                    Some("toolResult") => {
                        let is_yield = msg.get("toolName").and_then(|v| v.as_str())
                            == Some("yield");
                        let is_error =
                            msg.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
                        if is_yield && !is_error {
                            finishes.push(
                                obj.get("timestamp").and_then(|v| v.as_str()).map(str::to_string),
                            );
                        }
                    }
                    _ => {}
                }
            }

            let entry = self.subagent_files.get_mut(&name).unwrap();
            entry.1 += tool_calls;
            self.session.subagents[idx].tool_count = entry.1;
            for ts in finishes {
                self.finish_subagent(idx, ts);
            }
            changed = true;
        }
        changed
    }

    fn finalize(&mut self) {
        self.session.pending_tool =
            self.outstanding
                .first()
                .map(|(_, name, summary)| PendingTool {
                    name: name.clone(),
                    input_summary: summary.clone(),
                });
        self.session.context_pct = context_pct(
            self.session.context_tokens,
            self.session.model.as_deref().unwrap_or(""),
        );

        let subagent_running = self.session.subagents.iter().any(|s| !s.done);
        self.session.state = if self.session.pending_tool.is_none()
            && !subagent_running
            && matches!(&self.last_stop_reason, Some(r) if r != "toolUse")
        {
            SessionState::Idle
        } else {
            SessionState::Running
        };

        self.apply_working_marker();
    }
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

/// Every `text` block's `text`, joined — a user or assistant message's
/// content is an array of typed blocks (`text`, `image`, `toolCall`, …), only
/// some of which carry text.
fn text_blocks(content: &Value) -> String {
    content
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// The most identifying field of a `toolCall`'s arguments, falling back to
/// the model's own stated intent (`arguments.i`) when none of the usual keys
/// are present.
fn tool_call_summary(arguments: &Value) -> String {
    let summary = input_summary(arguments);
    if !summary.is_empty() {
        return summary;
    }
    arguments
        .get("i")
        .and_then(|v| v.as_str())
        .map(excerpt)
        .unwrap_or_default()
}

/// A `task` call's spawned-agent label — its short `name`, falling back to the
/// assignment text when unnamed.
fn task_label(entry: &Value) -> String {
    for key in ["name", "task"] {
        if let Some(value) = entry.get(key).and_then(|v| v.as_str()) {
            if !value.trim().is_empty() {
                return excerpt(value);
            }
        }
    }
    "Subagent".to_string()
}

/// `model_change`/assistant messages carry `<provider>/<model>`; the rest of
/// Atlas only ever shows the model half.
fn after_last_slash(model: &str) -> String {
    model.rsplit('/').next().unwrap_or(model).to_string()
}

/// `todo`'s `details.phases[{tasks[{content, status}]}]` — or
/// `user_todo_edit`'s `data.phases`, same shape — flattened, ignoring phase
/// names.
fn plan_from_phases(phases: &[Value]) -> Vec<PlanItem> {
    phases
        .iter()
        .filter_map(|phase| phase.get("tasks").and_then(|v| v.as_array()))
        .flatten()
        .filter_map(|task| {
            let text = task.get("content").and_then(|v| v.as_str())?;
            Some(PlanItem {
                text: text.to_string(),
                status: task.get("status").and_then(|v| v.as_str()).unwrap_or("pending").to_string(),
            })
        })
        .collect()
}

// ── Bulk stats parsing ────────────────────────────────────────────────────────

/// `(mtime, size)` — duplicated from `commands::stats::file_mtime_size` rather
/// than shared across the module boundary for one two-field tuple.
fn file_mtime_size(path: &Path) -> (u64, u64) {
    std::fs::metadata(path)
        .map(|m| {
            let mtime = m
                .modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
                .unwrap_or(0);
            (mtime, m.len())
        })
        .unwrap_or((0, 0))
}

/// Parse one OMP session transcript into the same `SessionRecord` shape
/// `commands::stats::parse_session` builds for Claude Code, one pass, so the
/// dashboard can fold both harnesses into one set of totals.
pub(crate) fn parse_omp_session(path: &Path) -> Result<SessionRecord, String> {
    let (mtime, size) = file_mtime_size(path);
    let mut session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);

    let mut title: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp: Option<String> = None;
    let mut user_messages: u32 = 0;
    let mut user_chars: u64 = 0;
    let mut assistant_messages: u32 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_creation_tokens: u64 = 0;
    let mut cost_estimate: f64 = 0.0;
    let mut peak_context: u64 = 0;
    let mut tool_calls: HashMap<String, u32> = HashMap::new();
    let mut tool_errors: u32 = 0;
    let mut tool_errors_by_name: HashMap<String, u32> = HashMap::new();
    let mut tool_name_by_id: HashMap<String, String> = HashMap::new();
    let mut subagents: u32 = 0;
    let mut by_model: HashMap<String, ModelSessionData> = HashMap::new();

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if let Some(ts) = obj.get("timestamp").and_then(|v| v.as_str()) {
            if first_timestamp.is_none() {
                first_timestamp = Some(ts.to_string());
            }
            last_timestamp = Some(ts.to_string());
        }

        match obj.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "session" => {
                if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                    session_id = id.to_string();
                }
                if let Some(c) = obj.get("cwd").and_then(|v| v.as_str()) {
                    cwd = Some(c.to_string());
                }
            }
            "title_change" => {
                if let Some(t) = obj.get("title").and_then(|v| v.as_str()) {
                    if !t.trim().is_empty() {
                        title = Some(t.to_string());
                    }
                }
            }
            "message" => {
                let msg = obj.get("message").unwrap_or(&Value::Null);
                match msg.get("role").and_then(|v| v.as_str()) {
                    Some("user") => {
                        if msg.get("attribution").and_then(|v| v.as_str()) == Some("user") {
                            let text = text_blocks(msg.get("content").unwrap_or(&Value::Null));
                            if !text.is_empty() {
                                user_messages += 1;
                                user_chars += text.chars().count() as u64;
                            }
                        }
                    }
                    Some("assistant") => {
                        assistant_messages += 1;
                        let family = msg
                            .get("model")
                            .and_then(|v| v.as_str())
                            .map(|m| model_family(&after_last_slash(m)));

                        if let Some(usage) = msg.get("usage") {
                            let output = usage.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
                            let cache_write =
                                usage.get("cacheWrite").and_then(|v| v.as_u64()).unwrap_or(0);
                            let cost = usage
                                .get("cost")
                                .and_then(|c| c.get("total"))
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            let input = usage.get("input").and_then(|v| v.as_u64()).unwrap_or(0);
                            let cache_read =
                                usage.get("cacheRead").and_then(|v| v.as_u64()).unwrap_or(0);
                            let ctx = input + cache_read + cache_write;

                            output_tokens += output;
                            cache_creation_tokens += cache_write;
                            cost_estimate += cost;
                            peak_context = peak_context.max(ctx);

                            if let Some(family) = &family {
                                let entry = by_model.entry(family.clone()).or_default();
                                entry.assistant_msgs += 1;
                                entry.output_tokens += output;
                                entry.cache_creation_tokens += cache_write;
                                entry.cost_estimate += cost;
                                if ctx > entry.peak_context {
                                    entry.peak_context = ctx;
                                }
                            }
                        }

                        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
                            for block in content {
                                if block.get("type").and_then(|v| v.as_str()) != Some("toolCall") {
                                    continue;
                                }
                                let name = block
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                *tool_calls.entry(name.clone()).or_insert(0) += 1;
                                if let Some(family) = &family {
                                    by_model.entry(family.clone()).or_default().tool_calls += 1;
                                }
                                if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                                    if !id.is_empty() {
                                        tool_name_by_id.insert(id.to_string(), name.clone());
                                    }
                                }
                                if name == "task" {
                                    if let Some(tasks) = block
                                        .get("arguments")
                                        .and_then(|a| a.get("tasks"))
                                        .and_then(|v| v.as_array())
                                    {
                                        subagents += tasks.len() as u32;
                                    }
                                }
                            }
                        }
                    }
                    Some("toolResult") => {
                        if msg.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) {
                            tool_errors += 1;
                            if let Some(id) = msg.get("toolCallId").and_then(|v| v.as_str()) {
                                if let Some(name) = tool_name_by_id.get(id) {
                                    *tool_errors_by_name.entry(name.clone()).or_insert(0) += 1;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let duration_secs = {
        let parse_ts = |s: &str| -> Option<i64> {
            chrono::DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp())
        };
        match (
            first_timestamp.as_deref().and_then(parse_ts),
            last_timestamp.as_deref().and_then(parse_ts),
        ) {
            (Some(start), Some(end)) if end > start => (end - start) as u64,
            _ => 0,
        }
    };

    Ok(SessionRecord {
        session_id,
        path: path.to_string_lossy().to_string(),
        mtime,
        size,
        title,
        cwd,
        git_branch: None,
        version: None,
        first_timestamp,
        last_timestamp,
        duration_secs,
        user_messages,
        user_chars,
        assistant_messages,
        peak_context,
        output_tokens,
        cache_creation_tokens,
        cost_estimate,
        subagents,
        tool_calls,
        tool_errors,
        tool_errors_by_name,
        by_model,
        by_model_subagents: HashMap::new(),
        subagent_invocations: HashMap::new(),
        harness: Some("omp".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const UUID: &str = "11111111-2222-4333-8444-555555555555";

    /// Write `lines` into a temp dir as `session.jsonl`, and return the tail
    /// plus the dir (kept alive for the test's duration).
    fn tail_with(lines: &[String]) -> (tempfile::TempDir, OmpTail) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{}", line).unwrap();
        }
        drop(file);
        (dir, OmpTail::new(UUID.to_string(), path))
    }

    fn append(path: &Path, lines: &[String]) {
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        for line in lines {
            writeln!(file, "{}", line).unwrap();
        }
    }

    #[test]
    fn prompt_reply_and_turn_duration_follow_the_newest_turn() {
        let user = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "user", "content": [{"type": "text", "text": "hi"}], "attribution": "user"}
        })
        .to_string();
        let assistant = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:05Z",
            "message": {"role": "assistant", "model": "anthropic/claude-opus-5-5", "stopReason": "stop",
                "content": [{"type": "text", "text": "done"}],
                "usage": {"input": 10, "output": 5, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 15,
                    "cost": {"total": 0.01}}}
        })
        .to_string();
        let (_dir, mut tail) = tail_with(&[user, assistant]);
        assert!(tail.poll());

        assert_eq!(tail.session().last_prompt.as_deref(), Some("hi"));
        assert_eq!(tail.session().last_reply.as_deref(), Some("done"));
        assert_eq!(tail.session().turn_duration_ms, Some(5000));
        assert_eq!(tail.session().state, SessionState::Idle);
    }

    #[test]
    fn an_unanswered_tool_call_is_pending_and_running() {
        let assistant = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "stopReason": "toolUse",
                "content": [{"type": "toolCall", "id": "t1", "name": "bash",
                    "arguments": {"command": "pnpm test", "i": "Running tests"}}]}
        })
        .to_string();
        let (_dir, mut tail) = tail_with(&[assistant]);
        assert!(tail.poll());

        let pending = tail.session().pending_tool.as_ref().expect("bash is unanswered");
        assert_eq!(pending.name, "bash");
        assert_eq!(pending.input_summary, "pnpm test");
        assert_eq!(tail.session().state, SessionState::Running);
        assert_eq!(tail.session().lines.last().unwrap().role, LineRole::Working);
    }

    #[test]
    fn todo_results_set_the_plan_and_view_is_ignored() {
        let view = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "toolResult", "toolCallId": "t0", "toolName": "todo", "isError": false,
                "content": [{"type": "text", "text": "ok"}],
                "details": {"op": "view", "phases": [
                    {"name": "Phase", "tasks": [{"content": "ignored", "status": "pending"}]}
                ]}}
        })
        .to_string();
        let write = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:01Z",
            "message": {"role": "toolResult", "toolCallId": "t1", "toolName": "todo", "isError": false,
                "content": [{"type": "text", "text": "ok"}],
                "details": {"op": "write", "phases": [
                    {"name": "Phase 1", "tasks": [
                        {"content": "Do the thing", "status": "completed"},
                        {"content": "Do the next thing", "status": "in_progress"}
                    ]}
                ]}}
        })
        .to_string();
        let (_dir, mut tail) = tail_with(&[view, write]);
        tail.poll();

        let plan = &tail.session().plan;
        assert_eq!(plan.len(), 2, "the view result did not touch the plan: {plan:?}");
        assert_eq!(plan[0].text, "Do the thing");
        assert_eq!(plan[0].status, "completed");
        assert_eq!(plan[1].status, "in_progress");
    }

    #[test]
    fn task_spawns_typed_subagents_a_launch_receipt_does_not_finish_them() {
        let call = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "stopReason": "toolUse",
                "content": [{"type": "toolCall", "id": "t1", "name": "task", "arguments": {
                    "i": "Spawn",
                    "tasks": [
                        {"name": "Scout1", "agent": "scout", "task": "look around"},
                        {"name": "Task1", "agent": "task", "task": "do the work"}
                    ]
                }}]}
        })
        .to_string();
        let receipt = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:01Z",
            "message": {"role": "toolResult", "toolCallId": "t1", "toolName": "task", "isError": false,
                "content": [{"type": "text", "text": "Spawned"}], "details": {}}
        })
        .to_string();
        let (_dir, mut tail) = tail_with(&[call, receipt]);
        tail.poll();

        let subagents = &tail.session().subagents;
        assert_eq!(subagents.len(), 2);
        assert_eq!(subagents[0].agent_type, Some("scout".to_string()));
        assert_eq!(subagents[1].agent_type, Some("task".to_string()));
        assert!(!subagents[0].done && !subagents[1].done, "a launch receipt is not completion");
    }

    #[test]
    fn a_yield_in_the_subagent_file_finishes_it_and_tool_calls_are_counted() {
        let call = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "stopReason": "toolUse",
                "content": [{"type": "toolCall", "id": "t1", "name": "task", "arguments": {
                    "tasks": [{"name": "Scout1", "agent": "scout", "task": "look around"}]
                }}]}
        })
        .to_string();
        let (dir, mut tail) = tail_with(&[call]);
        tail.poll();

        let sidecar = dir.path().join("session");
        std::fs::create_dir_all(&sidecar).unwrap();
        std::fs::write(
            sidecar.join("Scout1.jsonl"),
            concat!(
                r#"{"type":"message","timestamp":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"s1","name":"read","arguments":{}}]}}"#,
                "\n",
                r#"{"type":"message","timestamp":"2026-01-01T00:00:03Z","message":{"role":"toolResult","toolCallId":"s1","toolName":"read","isError":false,"content":[]}}"#,
                "\n",
                r#"{"type":"message","timestamp":"2026-01-01T00:00:04Z","message":{"role":"toolResult","toolCallId":"y1","toolName":"yield","isError":false,"content":[]}}"#,
                "\n",
            ),
        )
        .unwrap();

        tail.poll();
        let agent = &tail.session().subagents[0];
        assert_eq!(agent.tool_count, 1);
        assert!(agent.done);
        assert_eq!(agent.finished_at.as_deref(), Some("2026-01-01T00:00:04Z"));
    }

    #[test]
    fn an_async_result_finishes_the_job_it_names() {
        let call = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "stopReason": "toolUse",
                "content": [{"type": "toolCall", "id": "t1", "name": "task", "arguments": {
                    "tasks": [{"name": "Scout1", "agent": "scout", "task": "look around"}]
                }}]}
        })
        .to_string();
        let (dir, mut tail) = tail_with(&[call]);
        tail.poll();

        let async_result = serde_json::json!({
            "type": "custom_message", "customType": "async-result", "timestamp": "2026-01-01T00:05:00Z",
            "details": {"jobs": [{"jobId": "Scout1", "durationMs": 60_000}]}
        })
        .to_string();
        let path = dir.path().join("session.jsonl");
        append(&path, &[async_result]);
        assert!(tail.poll());

        let agent = &tail.session().subagents[0];
        assert!(agent.done);
        assert_eq!(agent.finished_at.as_deref(), Some("2026-01-01T00:01:00.000Z"));
    }

    #[test]
    fn usage_sums_omp_cost_and_context_follows_the_newest_reply_until_a_reset_boundary() {
        let a = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "stopReason": "stop", "content": [],
                "usage": {"input": 100, "output": 50, "cacheRead": 200, "cacheWrite": 0,
                    "totalTokens": 350, "cost": {"total": 0.05}}}
        })
        .to_string();
        let b = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:05Z",
            "message": {"role": "assistant", "stopReason": "stop", "content": [],
                "usage": {"input": 10, "output": 5, "cacheRead": 20, "cacheWrite": 0,
                    "totalTokens": 35, "cost": {"total": 0.01}}}
        })
        .to_string();
        let (dir, mut tail) = tail_with(&[a, b]);
        tail.poll();

        assert_eq!(tail.session().output_tokens, 55);
        assert!((tail.session().cost_estimate - 0.06).abs() < 1e-9);
        assert_eq!(tail.session().context_tokens, 10 + 20 + 5);
        assert_eq!(tail.session().peak_context, 300);

        let reset = serde_json::json!({"type": "reset_boundary", "timestamp": "2026-01-01T00:00:10Z"})
            .to_string();
        let path = dir.path().join("session.jsonl");
        append(&path, &[reset]);
        tail.poll();

        assert_eq!(tail.session().context_tokens, 0);
        assert_eq!(tail.session().peak_context, 300, "the historical high is kept");
    }

    #[test]
    fn session_exit_settles_everything_to_idle() {
        let call = serde_json::json!({
            "type": "message", "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "stopReason": "toolUse",
                "content": [
                    {"type": "toolCall", "id": "t1", "name": "task", "arguments": {
                        "tasks": [{"name": "Scout1", "agent": "scout", "task": "look around"}]
                    }},
                    {"type": "toolCall", "id": "t2", "name": "bash", "arguments": {"command": "pnpm test"}}
                ]}
        })
        .to_string();
        let (dir, mut tail) = tail_with(&[call]);
        tail.poll();
        assert_eq!(tail.session().state, SessionState::Running);

        let exit = serde_json::json!({
            "type": "custom", "customType": "session_exit", "timestamp": "2026-01-01T00:05:00Z",
            "data": {"reason": "dispose", "kind": "normal"}
        })
        .to_string();
        let path = dir.path().join("session.jsonl");
        append(&path, &[exit]);
        assert!(tail.poll());

        assert!(tail.session().subagents[0].done);
        assert!(tail.session().pending_tool.is_none());
        assert_eq!(tail.session().state, SessionState::Idle);
    }

    #[test]
    fn breadcrumb_path_maps_dev_ttys_to_the_file_omp_writes() {
        let agent_dir = Path::new("/home/user/.omp/agent");
        let path = breadcrumb_path(agent_dir, "/dev/ttys001");
        assert_eq!(path, agent_dir.join("terminal-sessions").join("ttys001"));
    }

    #[test]
    fn a_breadcrumb_older_than_since_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ttys001");
        std::fs::write(&path, "line one\nline two\n").unwrap();
        let since = SystemTime::now() + std::time::Duration::from_secs(60);
        assert_eq!(read_breadcrumb(&path, since), None);
    }
}
