use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use crate::transcript::{
    assistant_model, line_type, model_family, request_key, requests_to_by_model, tool_results,
    tool_uses, user_text, ModelSessionData, ReqData,
};

/// A "user" line can be genuinely typed by the human, or injected by a skill/hook/
/// background-task notification. Only the former should count as "a message from you" —
/// `promptSource: "sdk"/"system"` and `origin.kind: "task-notification"` mark the latter,
/// as does the `<local-command-caveat>` wrapper Claude Code puts around local-command output.
fn is_human_authored(obj: &Value, content: &str) -> bool {
    let prompt_source = obj.get("promptSource").and_then(|v| v.as_str());
    if matches!(prompt_source, Some("sdk") | Some("system")) {
        return false;
    }
    let origin_kind = obj
        .get("origin")
        .and_then(|o| o.get("kind"))
        .and_then(|v| v.as_str());
    if origin_kind == Some("task-notification") {
        return false;
    }
    !content.starts_with("<local-command-caveat>")
}

// ── Directory helpers ─────────────────────────────────────────────────────────

pub fn claude_projects_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())
        .map(|h| h.join(".claude").join("projects"))
}

fn stats_path() -> Result<PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?
        .join(".atlas");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("stats.json"))
}

// ── Version ───────────────────────────────────────────────────────────────────

const STATS_FILE_VERSION: u32 = 6;

// ── Data model ────────────────────────────────────────────────────────────────

/// One session's parsed stats. Stored in stats.json as the incremental cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: String,
    pub path: String,
    pub mtime: u64,
    pub size: u64,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub version: Option<String>,
    pub first_timestamp: Option<String>,
    pub last_timestamp: Option<String>,
    pub duration_secs: u64,
    pub user_messages: u32,
    pub assistant_messages: u32,
    pub peak_context: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost_estimate: f64,
    pub subagents: u32,
    pub tool_calls: HashMap<String, u32>,
    pub tool_errors: u32,
    /// Errored `tool_result`s resolved back to the tool that produced them, so
    /// the dashboard can show a per-tool error rate rather than one session-wide
    /// scalar. Sums to `tool_errors` minus any result whose `tool_use_id` had no
    /// matching `tool_use` block in this file (a subagent's, say).
    #[serde(default)]
    pub tool_errors_by_name: HashMap<String, u32>,
    pub by_model: HashMap<String, ModelSessionData>,
    #[serde(default)]
    pub by_model_subagents: HashMap<String, ModelSessionData>,
    /// Dominant model family -> count of subagent JSONL files using that family.
    #[serde(default)]
    pub subagent_invocations: HashMap<String, u32>,
    #[serde(default)]
    pub user_chars: u64,
}

/// Per-model aggregate — the Sonnet vs Opus comparison block.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelStats {
    pub sessions: u32,
    pub assistant_msgs: u64,
    pub user_messages: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost: f64,
    pub tool_calls: u64,
    pub tool_errors: u32,
    pub total_duration_secs: u64,
    pub total_subagents: u64,
    pub peak_context_max: u64,
    pub msgs_per_session: f64,
    pub tools_per_session: f64,
    pub error_rate: f64,
    pub cost_per_session: f64,
    pub output_per_session: f64,
    pub avg_duration_secs: f64,
    pub user_chars: u64,
    pub avg_message_chars: f64,
    pub subagents_per_session: f64,
    pub avg_output_per_msg: f64,
    pub cost_per_k_output: f64,
    #[serde(default)]
    pub subagent_prompt_chars: u64,
    #[serde(default)]
    pub subagent_prompt_count: u64,
    #[serde(default)]
    pub avg_subagent_prompt_chars: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub sessions: u32,
    pub output_tokens: u64,
    pub user_messages: u32,
    #[serde(default)]
    pub cost: f64,
    #[serde(default)]
    pub subagents: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub sessions: u32,
    pub output_tokens: u64,
    pub user_messages: u32,
    #[serde(default)]
    pub cost: f64,
    /// Largest single-session peak that day, not a sum.
    #[serde(default)]
    pub peak_context: u64,
    #[serde(default)]
    pub subagents: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeekStats {
    pub sessions: u32,
    /// model family -> number of primary sessions that week which used that family
    pub by_model: HashMap<String, u32>,
    /// model family -> number of subagent invocations that week using that family
    #[serde(default)]
    pub by_model_subagents: HashMap<String, u32>,
}

/// A session as the Recent-sessions table needs it. Deliberately a projection
/// of `SessionRecord` and not the record itself: `SessionRecord.path` is an
/// absolute transcript path and must not cross IPC.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentSession {
    pub session_id: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    /// Dominant model family for the session — the one with the most output tokens.
    pub model: Option<String>,
    pub last_timestamp: Option<String>,
    pub duration_secs: u64,
    pub output_tokens: u64,
    pub cost_estimate: f64,
}

impl RecentSession {
    fn from_record(rec: &SessionRecord) -> Self {
        // Dominant family = most output tokens; ties broken by name so the
        // choice is stable across runs.
        let model = rec
            .by_model
            .iter()
            .max_by(|(a_name, a), (b_name, b)| {
                a.output_tokens
                    .cmp(&b.output_tokens)
                    .then_with(|| b_name.cmp(a_name))
            })
            .map(|(family, _)| family.clone());
        RecentSession {
            session_id: rec.session_id.clone(),
            title: rec.title.clone(),
            cwd: rec.cwd.clone(),
            git_branch: rec.git_branch.clone(),
            model,
            last_timestamp: rec.last_timestamp.clone(),
            duration_secs: rec.duration_secs,
            output_tokens: rec.output_tokens,
            cost_estimate: rec.cost_estimate,
        }
    }
}

/// How many sessions the Recent-sessions table is given.
const RECENT_SESSION_LIMIT: usize = 50;

/// Headline numbers for one time window. The KPI strip renders one of these
/// against the equally-sized window immediately before it.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RangeTotals {
    pub sessions: u32,
    pub user_messages: u64,
    pub output_tokens: u64,
    pub cost: f64,
    /// Largest single-session peak in the window, not a sum.
    pub peak_context: u64,
    pub subagents: u32,
}

/// Everything the dashboard shows for one window, accumulated in a single pass.
/// `finish` moves the pieces onto `StatsSummary` under the right names.
#[derive(Default)]
struct WindowAcc {
    totals: RangeTotals,
    tool_usage: HashMap<String, u32>,
    tool_errors: HashMap<String, u32>,
    by_project: HashMap<String, ProjectStats>,
}

impl WindowAcc {
    fn add(&mut self, rec: &SessionRecord) {
        self.totals.sessions += 1;
        self.totals.user_messages += rec.user_messages as u64;
        self.totals.output_tokens += rec.output_tokens;
        self.totals.cost += rec.cost_estimate;
        self.totals.subagents += rec.subagents;
        if rec.peak_context > self.totals.peak_context {
            self.totals.peak_context = rec.peak_context;
        }
        for (tool, count) in &rec.tool_calls {
            *self.tool_usage.entry(tool.clone()).or_insert(0) += count;
        }
        for (tool, count) in &rec.tool_errors_by_name {
            *self.tool_errors.entry(tool.clone()).or_insert(0) += count;
        }
        if let Some(cwd) = &rec.cwd {
            let ps = self.by_project.entry(cwd.clone()).or_default();
            ps.sessions += 1;
            ps.output_tokens += rec.output_tokens;
            ps.user_messages += rec.user_messages;
            ps.cost += rec.cost_estimate;
            ps.subagents += rec.subagents;
        }
    }
}

/// The presentable summary returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub total_sessions: u32,
    pub total_user_messages: u64,
    pub total_assistant_messages: u64,
    pub peak_context_overall: u64,
    pub avg_peak_context: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cost_estimate: f64,
    pub total_tool_errors: u32,
    pub total_subagents: u32,
    pub error_rate: f64,
    pub by_model: HashMap<String, ModelStats>,
    /// Same as `by_model` but limited to sessions started in the last 30 days.
    #[serde(default)]
    pub by_model_30d: HashMap<String, ModelStats>,
    /// Same as `by_model` but limited to sessions started in the last 7 days.
    #[serde(default)]
    pub by_model_7d: HashMap<String, ModelStats>,
    /// Subagent invocation stats, keyed by model family.
    #[serde(default)]
    pub by_model_subagents: HashMap<String, ModelStats>,
    #[serde(default)]
    pub by_model_subagents_30d: HashMap<String, ModelStats>,
    #[serde(default)]
    pub by_model_subagents_7d: HashMap<String, ModelStats>,
    pub tool_usage: HashMap<String, u32>,
    /// Same keys as `tool_usage`, counting errored results per tool name.
    #[serde(default)]
    pub tool_errors: HashMap<String, u32>,
    #[serde(default)]
    pub tool_usage_30d: HashMap<String, u32>,
    #[serde(default)]
    pub tool_errors_30d: HashMap<String, u32>,
    #[serde(default)]
    pub tool_usage_7d: HashMap<String, u32>,
    #[serde(default)]
    pub tool_errors_7d: HashMap<String, u32>,
    pub by_project: HashMap<String, ProjectStats>,
    #[serde(default)]
    pub by_project_30d: HashMap<String, ProjectStats>,
    #[serde(default)]
    pub by_project_7d: HashMap<String, ProjectStats>,
    pub by_day: HashMap<String, DayStats>,
    pub by_week: HashMap<String, WeekStats>,
    /// The 50 newest sessions, newest first. A trimmed projection — see `RecentSession`.
    #[serde(default)]
    pub recent_sessions: Vec<RecentSession>,
    /// KPI-strip windows. `totals_prev_*` is the equally-sized window immediately
    /// before, which is what the delta badges compare against. All-time has no
    /// previous window and therefore no delta.
    #[serde(default)]
    pub totals_all: RangeTotals,
    #[serde(default)]
    pub totals_30d: RangeTotals,
    #[serde(default)]
    pub totals_prev_30d: RangeTotals,
    #[serde(default)]
    pub totals_7d: RangeTotals,
    #[serde(default)]
    pub totals_prev_7d: RangeTotals,
    pub versions: Vec<String>,
    pub generated_at: String,
}

/// The on-disk stats.json layout — summary + cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatsFile {
    pub version: u32,
    pub generated_at: String,
    pub summary: StatsSummary,
    pub sessions: Vec<SessionRecord>,
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/// Parse assistant lines from any JSONL path into per-model usage data.
/// Used for both the main session file and subagent files.
fn parse_model_usage(path: &Path) -> HashMap<String, ModelSessionData> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return HashMap::new(),
    };
    let reader = BufReader::new(file);
    let mut requests: HashMap<String, ReqData> = HashMap::new();

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        let obj: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if line_type(&obj) != "assistant" {
            continue;
        }
        let msg = obj.get("message").unwrap_or(&Value::Null);
        let Some(model) = assistant_model(&obj) else {
            continue;
        };
        let Some(req_key) = request_key(&obj) else {
            continue;
        };
        let new_tools: Vec<String> =
            tool_uses(msg).iter().map(|t| t.name.to_string()).collect();
        let entry = requests
            .entry(req_key)
            .or_insert_with(|| ReqData::from_message(model, msg));
        entry.tool_names.extend(new_tools);
    }

    requests_to_by_model(requests)
}

fn merge_model_data(
    base: &mut HashMap<String, ModelSessionData>,
    other: HashMap<String, ModelSessionData>,
) {
    for (family, data) in other {
        let entry = base.entry(family).or_default();
        entry.assistant_msgs += data.assistant_msgs;
        entry.output_tokens += data.output_tokens;
        entry.cache_creation_tokens += data.cache_creation_tokens;
        entry.cost_estimate += data.cost_estimate;
        entry.tool_calls += data.tool_calls;
        entry.user_chars += data.user_chars;
        entry.user_messages += data.user_messages;
        entry.subagent_prompt_chars += data.subagent_prompt_chars;
        entry.subagent_prompt_count += data.subagent_prompt_count;
        if data.peak_context > entry.peak_context {
            entry.peak_context = data.peak_context;
        }
    }
}

fn file_mtime_size(path: &Path) -> (u64, u64) {
    std::fs::metadata(path)
        .map(|m| {
            let mtime = m
                .modified()
                .map(|t| t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
                .unwrap_or(0);
            (mtime, m.len())
        })
        .unwrap_or((0, 0))
}

pub(crate) fn parse_session(path: &Path) -> Result<SessionRecord, String> {
    let (mtime, size) = file_mtime_size(path);
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // Count subagents in the sibling <session_id>/subagents/ directory
    let subagents = path
        .parent()
        .map(|p| p.join(&session_id).join("subagents"))
        .filter(|p| p.is_dir())
        .map(|d| {
            std::fs::read_dir(d)
                .map(|entries| {
                    entries
                        .flatten()
                        .filter(|e| {
                            e.path().extension().and_then(|x| x.to_str()) == Some("jsonl")
                        })
                        .count() as u32
                })
                .unwrap_or(0)
        })
        .unwrap_or(0);

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut title: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut version: Option<String> = None;
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp: Option<String> = None;
    let mut user_messages: u32 = 0;
    let mut user_chars: u64 = 0;
    let mut tool_errors: u32 = 0;
    let mut tool_errors_by_name: HashMap<String, u32> = HashMap::new();
    // `tool_use.id` -> tool name, so an errored `tool_result` can be charged to
    // the tool that produced it. A transcript is append-only and chronological,
    // so the `tool_use` is always already seen by the time its result arrives.
    let mut tool_name_by_id: HashMap<String, String> = HashMap::new();

    // Buffered until the next assistant turn, so chars are attributed to whichever
    // model family actually answered — not summed into every family in the session.
    let mut pending_user_chars: u64 = 0;
    let mut pending_user_messages: u32 = 0;
    let mut by_model_user: HashMap<String, (u64, u32)> = HashMap::new();
    // Chars of `Agent` tool prompts, attributed to the model family that sent them.
    let mut by_model_subagent_prompts: HashMap<String, (u64, u32)> = HashMap::new();

    // Keyed by requestId (or uuid fallback for requestId-less lines)
    let mut requests: HashMap<String, ReqData> = HashMap::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        let obj: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Metadata present on many line types
        if let Some(ts) = obj.get("timestamp").and_then(|v| v.as_str()) {
            if first_timestamp.is_none() {
                first_timestamp = Some(ts.to_string());
            }
            last_timestamp = Some(ts.to_string());
        }
        if cwd.is_none() {
            if let Some(c) = obj.get("cwd").and_then(|v| v.as_str()) {
                cwd = Some(c.to_string());
            }
        }
        if let Some(b) = obj.get("gitBranch").and_then(|v| v.as_str()) {
            git_branch = Some(b.to_string());
        }
        if let Some(v) = obj.get("version").and_then(|v| v.as_str()) {
            version = Some(v.to_string());
        }

        match line_type(&obj) {
            "user" => {
                let is_meta = obj.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
                if let Some(s) = user_text(&obj) {
                    if !is_meta && is_human_authored(&obj, s) {
                        user_messages += 1;
                        let chars = s.chars().count() as u64;
                        user_chars += chars;
                        pending_user_chars += chars;
                        pending_user_messages += 1;
                    }
                } else {
                    for result in tool_results(&obj) {
                        if result.is_error {
                            tool_errors += 1;
                            // An id with no matching `tool_use` in this file (a
                            // subagent's, say) still counts session-wide but has
                            // no tool to charge.
                            if let Some(name) = tool_name_by_id.get(result.tool_use_id) {
                                *tool_errors_by_name.entry(name.clone()).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
            "assistant" => {
                let msg = obj.get("message").unwrap_or(&Value::Null);
                let Some(model) = assistant_model(&obj) else {
                    continue;
                };
                let family = model_family(model);

                // Attribute any buffered human message(s) to the model that answered them.
                if pending_user_messages > 0 {
                    let entry = by_model_user.entry(family.clone()).or_insert((0, 0));
                    entry.0 += pending_user_chars;
                    entry.1 += pending_user_messages;
                    pending_user_chars = 0;
                    pending_user_messages = 0;
                }

                // Use requestId as key; fall back to uuid if absent
                let Some(req_key) = request_key(&obj) else {
                    continue;
                };

                // Collect tool_use names from this line's content (across all lines for same req)
                let mut new_tools: Vec<String> = Vec::new();
                for tool in tool_uses(msg) {
                    if tool.name == "Agent" {
                        if let Some(prompt) = tool.input.get("prompt").and_then(|v| v.as_str()) {
                            let entry = by_model_subagent_prompts
                                .entry(family.clone())
                                .or_insert((0, 0));
                            entry.0 += prompt.chars().count() as u64;
                            entry.1 += 1;
                        }
                    }
                    if !tool.id.is_empty() {
                        tool_name_by_id.insert(tool.id.to_string(), tool.name.to_string());
                    }
                    new_tools.push(tool.name.to_string());
                }

                let entry = requests
                    .entry(req_key)
                    .or_insert_with(|| ReqData::from_message(model, msg));
                entry.tool_names.extend(new_tools);
            }
            "ai-title" => {
                if let Some(t) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                    title = Some(t.to_string());
                }
            }
            _ => {}
        }
    }

    // Aggregate from per-request data
    let mut peak_context: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_creation_tokens: u64 = 0;
    let mut cost_estimate: f64 = 0.0;
    let mut tool_calls: HashMap<String, u32> = HashMap::new();

    for data in requests.values() {
        let ctx = data.context();
        if ctx > peak_context {
            peak_context = ctx;
        }
        output_tokens += data.output_tokens;
        cache_creation_tokens += data.cache_create;
        cost_estimate += data.cost();
        for name in &data.tool_names {
            *tool_calls.entry(name.clone()).or_insert(0) += 1;
        }
    }

    let assistant_messages = requests.len() as u32;
    let mut by_model = requests_to_by_model(requests);
    for (family, (chars, messages)) in by_model_user {
        let entry = by_model.entry(family).or_default();
        entry.user_chars += chars;
        entry.user_messages += messages;
    }
    for (family, (chars, count)) in by_model_subagent_prompts {
        let entry = by_model.entry(family).or_default();
        entry.subagent_prompt_chars += chars;
        entry.subagent_prompt_count += count;
    }

    // Parse subagents separately so primary vs delegated usage are tracked independently.
    let mut by_model_subagents: HashMap<String, ModelSessionData> = HashMap::new();
    let mut subagent_invocations: HashMap<String, u32> = HashMap::new();

    if let Some(subagents_dir) = path
        .parent()
        .map(|p| p.join(&session_id).join("subagents"))
        .filter(|p| p.is_dir())
    {
        if let Ok(entries) = std::fs::read_dir(&subagents_dir) {
            for entry in entries.flatten() {
                let sub_path = entry.path();
                if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    let sub_usage = parse_model_usage(&sub_path);
                    // Attribute this invocation to the family with the most output tokens.
                    if let Some(dominant) = sub_usage
                        .iter()
                        .max_by_key(|(_, d)| d.output_tokens)
                        .map(|(f, _)| f.clone())
                    {
                        *subagent_invocations.entry(dominant).or_insert(0) += 1;
                    }
                    // Add subagent cost/tokens to session-level totals so the headline numbers
                    // reflect all work done, not just the primary context.
                    for sub_data in sub_usage.values() {
                        output_tokens += sub_data.output_tokens;
                        cache_creation_tokens += sub_data.cache_creation_tokens;
                        cost_estimate += sub_data.cost_estimate;
                    }
                    merge_model_data(&mut by_model_subagents, sub_usage);
                }
            }
        }
    }

    let duration_secs = {
        let parse_ts = |s: &str| -> Option<i64> {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.timestamp())
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
        git_branch,
        version,
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
        by_model_subagents,
        subagent_invocations,
    })
}

// ── Session file discovery ────────────────────────────────────────────────────

/// Walk `~/.claude/projects/` and return paths of all session *.jsonl files
/// (direct children of project subdirs, not in subagents/ dirs).
fn collect_session_files(projects_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(project_entries) = std::fs::read_dir(projects_dir) else {
        return files;
    };
    for project_entry in project_entries.flatten() {
        if !project_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(session_entries) = std::fs::read_dir(project_entry.path()) else {
            continue;
        };
        for session_entry in session_entries.flatten() {
            let path = session_entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                && session_entry.file_type().map(|t| t.is_file()).unwrap_or(false)
            {
                files.push(path);
            }
        }
    }
    files
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/// Fold one session record into a per-model-family accumulator (raw sums only;
/// call `finalize_model` afterwards to fill in the derived averages).
fn accumulate_model(model_acc: &mut HashMap<String, ModelStats>, rec: &SessionRecord) {
    for (family, model_data) in &rec.by_model {
        let ms = model_acc.entry(family.clone()).or_default();
        ms.sessions += 1;
        ms.assistant_msgs += model_data.assistant_msgs as u64;
        ms.user_messages += model_data.user_messages as u64;
        ms.user_chars += model_data.user_chars;
        ms.subagent_prompt_chars += model_data.subagent_prompt_chars;
        ms.subagent_prompt_count += model_data.subagent_prompt_count as u64;
        ms.output_tokens += model_data.output_tokens;
        ms.cache_creation_tokens += model_data.cache_creation_tokens;
        ms.cost += model_data.cost_estimate;
        ms.tool_calls += model_data.tool_calls as u64;
        ms.tool_errors += rec.tool_errors;
        ms.total_duration_secs += rec.duration_secs;
        ms.total_subagents += rec.subagents as u64;
        if model_data.peak_context > ms.peak_context_max {
            ms.peak_context_max = model_data.peak_context;
        }
    }
}

fn accumulate_subagent_model(model_acc: &mut HashMap<String, ModelStats>, rec: &SessionRecord) {
    for (family, model_data) in &rec.by_model_subagents {
        let ms = model_acc.entry(family.clone()).or_default();
        ms.sessions += 1;
        ms.assistant_msgs += model_data.assistant_msgs as u64;
        ms.output_tokens += model_data.output_tokens;
        ms.cache_creation_tokens += model_data.cache_creation_tokens;
        ms.cost += model_data.cost_estimate;
        ms.tool_calls += model_data.tool_calls as u64;
        if model_data.peak_context > ms.peak_context_max {
            ms.peak_context_max = model_data.peak_context;
        }
    }
}

/// Fill in the derived per-session averages once all records have been folded in.
fn finalize_model(model_acc: &mut HashMap<String, ModelStats>) {
    for ms in model_acc.values_mut() {
        if ms.sessions > 0 {
            ms.msgs_per_session = ms.user_messages as f64 / ms.sessions as f64;
            ms.tools_per_session = ms.tool_calls as f64 / ms.sessions as f64;
            ms.cost_per_session = ms.cost / ms.sessions as f64;
            ms.output_per_session = ms.output_tokens as f64 / ms.sessions as f64;
            ms.avg_duration_secs = ms.total_duration_secs as f64 / ms.sessions as f64;
            ms.subagents_per_session = ms.total_subagents as f64 / ms.sessions as f64;
        }
        if ms.user_messages > 0 {
            ms.avg_message_chars = ms.user_chars as f64 / ms.user_messages as f64;
        }
        if ms.subagent_prompt_count > 0 {
            ms.avg_subagent_prompt_chars =
                ms.subagent_prompt_chars as f64 / ms.subagent_prompt_count as f64;
        }
        if ms.assistant_msgs > 0 {
            ms.avg_output_per_msg = ms.output_tokens as f64 / ms.assistant_msgs as f64;
        }
        if ms.output_tokens > 0 {
            ms.cost_per_k_output = ms.cost / ms.output_tokens as f64 * 1000.0;
        }
        let total_calls = ms.tool_calls + ms.tool_errors as u64;
        if total_calls > 0 {
            ms.error_rate = ms.tool_errors as f64 / total_calls as f64;
        }
    }
}

fn aggregate(records: &[SessionRecord]) -> StatsSummary {
    let mut summary = StatsSummary::default();
    let now = chrono::Utc::now();
    summary.generated_at = now.to_rfc3339();
    let cutoff_30d = now - chrono::Duration::days(30);
    let cutoff_7d = now - chrono::Duration::days(7);
    // The equally-sized window immediately before each of the above.
    let cutoff_prev_30d = now - chrono::Duration::days(60);
    let cutoff_prev_7d = now - chrono::Duration::days(14);

    let mut peak_sum: u64 = 0;
    let mut versions_set: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Intermediate by_model accumulators (without derived fields): all-time + windows
    let mut model_acc: HashMap<String, ModelStats> = HashMap::new();
    let mut model_acc_30d: HashMap<String, ModelStats> = HashMap::new();
    let mut model_acc_7d: HashMap<String, ModelStats> = HashMap::new();
    let mut subagent_acc: HashMap<String, ModelStats> = HashMap::new();
    let mut subagent_acc_30d: HashMap<String, ModelStats> = HashMap::new();
    let mut subagent_acc_7d: HashMap<String, ModelStats> = HashMap::new();

    // Window accumulators: all-time, the two live windows, and the two windows
    // immediately before them that the KPI deltas compare against.
    let mut win_all = WindowAcc::default();
    let mut win_30d = WindowAcc::default();
    let mut win_prev_30d = WindowAcc::default();
    let mut win_7d = WindowAcc::default();
    let mut win_prev_7d = WindowAcc::default();

    let mut recent: Vec<&SessionRecord> = Vec::with_capacity(records.len());

    for rec in records {
        summary.total_sessions += 1;
        summary.total_user_messages += rec.user_messages as u64;
        summary.total_assistant_messages += rec.assistant_messages as u64;
        if rec.peak_context > summary.peak_context_overall {
            summary.peak_context_overall = rec.peak_context;
        }
        peak_sum += rec.peak_context;
        summary.total_output_tokens += rec.output_tokens;
        summary.total_cache_creation_tokens += rec.cache_creation_tokens;
        summary.total_cost_estimate += rec.cost_estimate;
        summary.total_tool_errors += rec.tool_errors;
        summary.total_subagents += rec.subagents;

        win_all.add(rec);
        recent.push(rec);

        // Per day
        if let Some(ts) = &rec.first_timestamp {
            let day = ts.get(..10).unwrap_or("").to_string();
            if !day.is_empty() {
                let ds = summary.by_day.entry(day).or_default();
                ds.sessions += 1;
                ds.output_tokens += rec.output_tokens;
                ds.user_messages += rec.user_messages;
                ds.cost += rec.cost_estimate;
                ds.subagents += rec.subagents;
                if rec.peak_context > ds.peak_context {
                    ds.peak_context = rec.peak_context;
                }
            }
        }

        if let Some(v) = &rec.version {
            versions_set.insert(v.clone());
        }

        // Per model family — all-time always; windowed copies keyed off session start time.
        accumulate_model(&mut model_acc, rec);
        accumulate_subagent_model(&mut subagent_acc, rec);
        let started = rec
            .first_timestamp
            .as_deref()
            .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc));
        if let Some(dt) = started {
            if dt >= cutoff_30d {
                accumulate_model(&mut model_acc_30d, rec);
                accumulate_subagent_model(&mut subagent_acc_30d, rec);
                win_30d.add(rec);
            } else if dt >= cutoff_prev_30d {
                win_prev_30d.add(rec);
            }
            if dt >= cutoff_7d {
                accumulate_model(&mut model_acc_7d, rec);
                accumulate_subagent_model(&mut subagent_acc_7d, rec);
                win_7d.add(rec);
            } else if dt >= cutoff_prev_7d {
                win_prev_7d.add(rec);
            }
        }

        // Per ISO week
        if let Some(ts) = &rec.first_timestamp {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                use chrono::Datelike;
                let iso = dt.iso_week();
                let key = format!("{:04}-W{:02}", iso.year(), iso.week());
                let ws = summary.by_week.entry(key).or_default();
                ws.sessions += 1;
                for family in rec.by_model.keys() {
                    *ws.by_model.entry(family.clone()).or_insert(0) += 1;
                }
                for (family, count) in &rec.subagent_invocations {
                    *ws.by_model_subagents.entry(family.clone()).or_insert(0) += count;
                }
            }
        }
    }

    summary.totals_all = win_all.totals;
    summary.tool_usage = win_all.tool_usage;
    summary.tool_errors = win_all.tool_errors;
    summary.by_project = win_all.by_project;
    summary.totals_30d = win_30d.totals;
    summary.tool_usage_30d = win_30d.tool_usage;
    summary.tool_errors_30d = win_30d.tool_errors;
    summary.by_project_30d = win_30d.by_project;
    summary.totals_7d = win_7d.totals;
    summary.tool_usage_7d = win_7d.tool_usage;
    summary.tool_errors_7d = win_7d.tool_errors;
    summary.by_project_7d = win_7d.by_project;
    summary.totals_prev_30d = win_prev_30d.totals;
    summary.totals_prev_7d = win_prev_7d.totals;

    // Newest first; the table only ever shows a page of them.
    recent.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
    summary.recent_sessions = recent
        .into_iter()
        .take(RECENT_SESSION_LIMIT)
        .map(RecentSession::from_record)
        .collect();

    // Derived averages
    if summary.total_sessions > 0 {
        summary.avg_peak_context = peak_sum / summary.total_sessions as u64;
    }
    let total_tool_calls: u64 = summary.tool_usage.values().map(|v| *v as u64).sum();
    if total_tool_calls > 0 {
        summary.error_rate = summary.total_tool_errors as f64 / total_tool_calls as f64;
    }

    finalize_model(&mut model_acc);
    finalize_model(&mut model_acc_30d);
    finalize_model(&mut model_acc_7d);
    finalize_model(&mut subagent_acc);
    finalize_model(&mut subagent_acc_30d);
    finalize_model(&mut subagent_acc_7d);
    summary.by_model = model_acc;
    summary.by_model_30d = model_acc_30d;
    summary.by_model_7d = model_acc_7d;
    summary.by_model_subagents = subagent_acc;
    summary.by_model_subagents_30d = subagent_acc_30d;
    summary.by_model_subagents_7d = subagent_acc_7d;

    let mut versions: Vec<String> = versions_set.into_iter().collect();
    versions.sort();
    summary.versions = versions;

    summary
}

// ── Recompute ─────────────────────────────────────────────────────────────────

static RECOMPUTE_LOCK: Mutex<()> = Mutex::new(());

/// The reusable half of an on-disk stats.json, keyed by transcript path.
///
/// Only a file written by *this* `STATS_FILE_VERSION` is reused. An older file
/// would deserialize with `Default`s for every field added since, so the numbers
/// would be silently wrong rather than merely missing — an unrecognised version
/// must force a full re-parse instead.
fn cache_from_json(json: &str) -> HashMap<String, SessionRecord> {
    serde_json::from_str::<StatsFile>(json)
        .ok()
        .filter(|f| f.version == STATS_FILE_VERSION)
        .map(|f| f.sessions.into_iter().map(|s| (s.path.clone(), s)).collect())
        .unwrap_or_default()
}

/// Walk all session files, re-parse changed ones, aggregate, write stats.json.
pub fn recompute() -> Result<StatsSummary, String> {
    let _guard = RECOMPUTE_LOCK.lock().map_err(|e| e.to_string())?;

    let projects_dir = claude_projects_dir()?;
    if !projects_dir.exists() {
        return Ok(StatsSummary::default());
    }

    let stats_path = stats_path()?;

    let cache = std::fs::read_to_string(&stats_path)
        .map(|s| cache_from_json(&s))
        .unwrap_or_default();

    let session_files = collect_session_files(&projects_dir);
    let mut seen_paths: std::collections::HashSet<String> =
        std::collections::HashSet::with_capacity(session_files.len());
    let mut records: Vec<SessionRecord> = Vec::with_capacity(session_files.len());

    for path in &session_files {
        let path_str = path.to_string_lossy().to_string();
        let (mtime, size) = file_mtime_size(path);
        seen_paths.insert(path_str.clone());

        if let Some(cached) = cache.get(&path_str) {
            if cached.mtime == mtime && cached.size == size {
                records.push(cached.clone());
                continue;
            }
        }

        match parse_session(path) {
            Ok(rec) => records.push(rec),
            Err(e) => log::warn!("Failed to parse session {}: {}", path.display(), e),
        }
    }

    // Keep cached records whose source .jsonl has since been deleted (e.g. by the
    // CLI's own transcript retention cleanup) — otherwise historical stats vanish
    // from Atlas's cache the moment the underlying file is pruned.
    for (path_str, cached) in &cache {
        if !seen_paths.contains(path_str) {
            records.push(cached.clone());
        }
    }

    let summary = aggregate(&records);

    // Write updated stats.json
    let file = StatsFile {
        version: STATS_FILE_VERSION,
        generated_at: summary.generated_at.clone(),
        summary: summary.clone(),
        sessions: records,
    };
    match serde_json::to_string_pretty(&file) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&stats_path, json) {
                log::warn!("Failed to write stats.json: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize stats: {}", e),
    }

    Ok(summary)
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub async fn get_claude_stats() -> Result<StatsSummary, String> {
    tokio::task::spawn_blocking(recompute)
        .await
        .map_err(|e| e.to_string())?
}

// ── Watcher ───────────────────────────────────────────────────────────────────

fn is_session_jsonl(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        && !path
            .components()
            .any(|c| c.as_os_str() == "subagents")
}

/// Holds the stats watcher alive for the life of the app. `Manager::manage` is
/// keyed by type, so a bare `RecommendedWatcher` here would collide with the
/// panel watcher's and be dropped on registration — taking `stats-update` with it.
pub struct StatsWatcher(#[allow(dead_code)] RecommendedWatcher);

pub fn start_stats_watcher(app_handle: AppHandle) -> Result<StatsWatcher, String> {
    let projects_dir = claude_projects_dir()?;
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(500)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&projects_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let debounce = Duration::from_millis(1000);
        let mut last_recompute = Instant::now() - debounce;

        for event in rx {
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                continue;
            }
            let has_session_file = event.paths.iter().any(|p| is_session_jsonl(p));
            if !has_session_file {
                continue;
            }
            if last_recompute.elapsed() < debounce {
                continue;
            }
            last_recompute = Instant::now();
            match recompute() {
                Ok(summary) => {
                    let _ = handle.emit("stats-update", &summary);
                }
                Err(e) => log::warn!("Stats recompute failed: {}", e),
            }
        }
    });

    Ok(StatsWatcher(watcher))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_lines(lines: &[&str]) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        f
    }

    #[test]
    fn counts_user_messages_only_string_content() {
        let f = write_lines(&[
            r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","is_error":false}]},"timestamp":"2026-01-01T00:01:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"sys"},"timestamp":"2026-01-01T00:02:00Z","cwd":"/tmp"}"#,
        ]);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.user_messages, 1, "only the plain-string non-meta line counts");
    }

    #[test]
    fn counts_tool_errors_from_is_error_true() {
        let f = write_lines(&[
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","is_error":true}]},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"y","is_error":false}]},"timestamp":"2026-01-01T00:01:00Z","cwd":"/tmp"}"#,
        ]);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.tool_errors, 1);
    }

    #[test]
    fn deduplicates_request_ids_for_tokens() {
        // Two lines with same requestId — usage should be counted once
        let lines = &[
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[{"type":"thinking","thinking":"..."}],"usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":50,"output_tokens":200}},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":50,"output_tokens":200}},"timestamp":"2026-01-01T00:00:01Z","cwd":"/tmp"}"#,
        ];
        let f = write_lines(lines);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.output_tokens, 200, "output counted once, not twice");
        assert_eq!(rec.cache_creation_tokens, 50, "cache_create counted once");
        assert_eq!(rec.assistant_messages, 1, "one unique requestId");
    }

    #[test]
    fn peak_context_uses_max_not_sum() {
        // Two requests — peak should be max(150, 300) = 300, not 450
        let lines = &[
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":50,"output_tokens":10}},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"assistant","requestId":"req2","message":{"model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":200,"cache_read_input_tokens":50,"cache_creation_input_tokens":50,"output_tokens":10}},"timestamp":"2026-01-01T00:01:00Z","cwd":"/tmp"}"#,
        ];
        let f = write_lines(lines);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.peak_context, 300, "peak is max(150, 300)");
        assert_eq!(rec.output_tokens, 20, "output is summed");
    }

    #[test]
    fn splits_tool_use_across_multi_line_request() {
        // Three lines for same requestId, each with different tool_use blocks
        let lines = &[
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","name":"Read","id":"t1"}],"usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":10}},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","name":"Edit","id":"t2"}],"usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":10}},"timestamp":"2026-01-01T00:00:01Z","cwd":"/tmp"}"#,
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","name":"Bash","id":"t3"}],"usage":{"input_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":10}},"timestamp":"2026-01-01T00:00:02Z","cwd":"/tmp"}"#,
        ];
        let f = write_lines(lines);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.tool_calls.get("Read").copied().unwrap_or(0), 1);
        assert_eq!(rec.tool_calls.get("Edit").copied().unwrap_or(0), 1);
        assert_eq!(rec.tool_calls.get("Bash").copied().unwrap_or(0), 1);
        assert_eq!(rec.output_tokens, 10, "usage counted once despite 3 lines");
    }

    #[test]
    fn extracts_ai_title() {
        let f = write_lines(&[
            r#"{"type":"ai-title","aiTitle":"My session title","sessionId":"abc"}"#,
        ]);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.title.as_deref(), Some("My session title"));
    }

    #[test]
    fn model_family_grouping() {
        assert_eq!(model_family("claude-opus-4-8"), "Opus");
        assert_eq!(model_family("claude-sonnet-4-6"), "Sonnet");
        assert_eq!(model_family("claude-haiku-4-5"), "Haiku");
        assert_eq!(model_family("claude-fable-5"), "Fable");
        assert_eq!(model_family("unknown-model"), "unknown-model");
    }

    #[test]
    fn counts_user_chars_only_string_content() {
        // "hi" (2 chars) + "hello" (5 chars) = 7; array-content and isMeta are ignored
        let f = write_lines(&[
            r#"{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:01:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","is_error":false}]},"timestamp":"2026-01-01T00:02:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"sys"},"timestamp":"2026-01-01T00:03:00Z","cwd":"/tmp"}"#,
        ]);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.user_messages, 2);
        assert_eq!(rec.user_chars, 7, "only counts chars from plain-string non-meta messages");
    }

    #[test]
    fn attributes_user_chars_to_the_model_that_answered_not_every_model_in_session() {
        // A short message answered by Sonnet, then a long message answered by Opus.
        // Each family's user_chars should reflect only the turn it actually answered.
        let lines = &[
            r#"{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-sonnet-4-6","content":[],"usage":{"input_tokens":10,"output_tokens":10}},"timestamp":"2026-01-01T00:00:01Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":"a much longer follow-up message here"},"timestamp":"2026-01-01T00:00:02Z","cwd":"/tmp"}"#,
            r#"{"type":"assistant","requestId":"req2","message":{"model":"claude-opus-4-8","content":[],"usage":{"input_tokens":10,"output_tokens":10}},"timestamp":"2026-01-01T00:00:03Z","cwd":"/tmp"}"#,
        ];
        let f = write_lines(lines);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.by_model["Sonnet"].user_chars, 2, "Sonnet only answered the 2-char message");
        assert_eq!(rec.by_model["Sonnet"].user_messages, 1);
        assert_eq!(rec.by_model["Opus"].user_chars, 36, "Opus only answered the 36-char message");
        assert_eq!(rec.by_model["Opus"].user_messages, 1);
        // Session-level totals still cover both turns
        assert_eq!(rec.user_messages, 2);
        assert_eq!(rec.user_chars, 38);
    }

    #[test]
    fn captures_agent_tool_prompt_chars_per_spawning_model() {
        let lines = &[
            r#"{"type":"assistant","requestId":"req1","message":{"model":"claude-opus-4-8","content":[{"type":"tool_use","name":"Agent","id":"t1","input":{"prompt":"go find the bug"}}],"usage":{"input_tokens":10,"output_tokens":10}},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
        ];
        let f = write_lines(lines);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.by_model["Opus"].subagent_prompt_chars, 15);
        assert_eq!(rec.by_model["Opus"].subagent_prompt_count, 1);
        assert_eq!(rec.by_model["Opus"].user_chars, 0, "subagent prompts aren't counted as human messages");
    }

    #[test]
    fn excludes_sdk_and_task_notification_and_local_command_caveat_from_user_chars() {
        let lines = &[
            // Genuinely typed by the human — counts.
            r#"{"type":"user","message":{"role":"user","content":"hello there"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp","promptSource":"typed"}"#,
            // Skill/hook-injected via the SDK (e.g. security-review) — doesn't count.
            r#"{"type":"user","message":{"role":"user","content":"Review this change for security vulnerabilities."},"timestamp":"2026-01-01T00:00:01Z","cwd":"/tmp","promptSource":"sdk"}"#,
            // Background task completion ping — doesn't count.
            r#"{"type":"user","message":{"role":"user","content":"<task-notification>done</task-notification>"},"timestamp":"2026-01-01T00:00:02Z","cwd":"/tmp","origin":{"kind":"task-notification"}}"#,
            // Wrapper around local-command output — doesn't count.
            r#"{"type":"user","message":{"role":"user","content":"<local-command-caveat>Caveat: ...</local-command-caveat>"},"timestamp":"2026-01-01T00:00:03Z","cwd":"/tmp"}"#,
        ];
        let f = write_lines(lines);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.user_messages, 1, "only the typed human message counts");
        assert_eq!(rec.user_chars, 11, "\"hello there\" is 11 chars");
    }

    // ── Phase 09: per-tool errors, workspace cost, ranges, recent sessions ──

    /// A record with every field filled in; callers tweak the ones they care about.
    fn rec(id: &str, ts: &str) -> SessionRecord {
        SessionRecord {
            session_id: id.to_string(),
            path: format!("/fake/{id}.jsonl"),
            mtime: 0,
            size: 0,
            title: Some(format!("title {id}")),
            cwd: Some("/repo/atlas".to_string()),
            git_branch: Some("main".to_string()),
            version: None,
            first_timestamp: Some(ts.to_string()),
            last_timestamp: Some(ts.to_string()),
            duration_secs: 60,
            user_messages: 2,
            user_chars: 10,
            assistant_messages: 1,
            peak_context: 1000,
            output_tokens: 100,
            cache_creation_tokens: 0,
            cost_estimate: 1.0,
            subagents: 1,
            tool_calls: HashMap::from([("Bash".to_string(), 4)]),
            tool_errors: 1,
            tool_errors_by_name: HashMap::from([("Bash".to_string(), 1)]),
            by_model: HashMap::from([("Sonnet".to_string(), ModelSessionData::default())]),
            by_model_subagents: HashMap::new(),
            subagent_invocations: HashMap::new(),
        }
    }

    #[test]
    fn tool_errors_are_attributed_to_the_tool_that_produced_them() {
        // Bash errors, Read succeeds, and a result whose tool_use_id was never
        // seen counts session-wide but is charged to no tool.
        let f = write_lines(&[
            r#"{"type":"assistant","requestId":"r1","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}},{"type":"tool_use","id":"t2","name":"Read","input":{}}],"usage":{"input_tokens":10,"output_tokens":10}},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","is_error":true}]},"timestamp":"2026-01-01T00:00:01Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t2","is_error":false}]},"timestamp":"2026-01-01T00:00:02Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"orphan","is_error":true}]},"timestamp":"2026-01-01T00:00:03Z","cwd":"/tmp"}"#,
        ]);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(rec.tool_errors, 2, "both errored results still count session-wide");
        assert_eq!(rec.tool_errors_by_name.get("Bash").copied(), Some(1));
        assert_eq!(rec.tool_errors_by_name.get("Read").copied(), None);
        assert_eq!(rec.tool_errors_by_name.len(), 1, "the orphan id is charged to no tool");
    }

    #[test]
    fn tool_errors_match_the_real_transcript_fixture() {
        // tests/fixtures/session.jsonl: 14 Bash calls of which exactly one errored.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("session.jsonl");
        let rec = parse_session(&path).unwrap();
        assert_eq!(rec.tool_calls.get("Bash").copied(), Some(14));
        assert_eq!(rec.tool_errors_by_name.get("Bash").copied(), Some(1));
        assert_eq!(rec.tool_errors, 1);
        assert!(
            !rec.tool_errors_by_name.contains_key("Read"),
            "Read never errored in the fixture"
        );
    }

    #[test]
    fn by_project_carries_cost_and_subagents() {
        let mut a = rec("a", "2026-01-01T00:00:00Z");
        a.cwd = Some("/repo/one".to_string());
        a.cost_estimate = 2.5;
        a.subagents = 3;
        let mut b = rec("b", "2026-01-02T00:00:00Z");
        b.cwd = Some("/repo/one".to_string());
        b.cost_estimate = 1.5;
        b.subagents = 1;
        let summary = aggregate(&[a, b]);
        let ps = summary.by_project.get("/repo/one").expect("project key");
        assert_eq!(ps.sessions, 2);
        assert_eq!(ps.subagents, 4);
        assert!((ps.cost - 4.0).abs() < 1e-9, "cost is summed across sessions");
        assert_eq!(ps.output_tokens, 200);
    }

    #[test]
    fn range_totals_split_current_and_previous_windows() {
        let now = chrono::Utc::now();
        let at = |days: i64| (now - chrono::Duration::days(days)).to_rfc3339();
        // 2 sessions in the last 7d, 1 in the 7-14d window, 1 in the 30-60d window,
        // and 1 older than every window.
        let records = vec![
            rec("now1", &at(1)),
            rec("now2", &at(3)),
            rec("prev7", &at(10)),
            rec("prev30", &at(45)),
            rec("ancient", &at(400)),
        ];
        let s = aggregate(&records);

        assert_eq!(s.totals_all.sessions, 5);
        assert_eq!(s.totals_7d.sessions, 2);
        assert_eq!(s.totals_prev_7d.sessions, 1, "7-14 days ago");
        assert_eq!(s.totals_30d.sessions, 3, "everything inside 30 days");
        assert_eq!(s.totals_prev_30d.sessions, 1, "30-60 days ago");

        // Each record carries cost 1.0, 100 output tokens, 2 user messages, 1 subagent.
        assert!((s.totals_7d.cost - 2.0).abs() < 1e-9);
        assert_eq!(s.totals_7d.output_tokens, 200);
        assert_eq!(s.totals_7d.user_messages, 4);
        assert_eq!(s.totals_7d.subagents, 2);
        assert_eq!(s.totals_7d.peak_context, 1000, "peak is a max, not a sum");
    }

    #[test]
    fn tool_usage_and_by_project_are_windowed_like_the_model_tables() {
        let now = chrono::Utc::now();
        let at = |days: i64| (now - chrono::Duration::days(days)).to_rfc3339();
        let mut old = rec("old", &at(200));
        old.cwd = Some("/repo/archived".to_string());
        let records = vec![rec("fresh", &at(2)), old];
        let s = aggregate(&records);

        assert_eq!(s.tool_usage.get("Bash").copied(), Some(8), "all-time sums both");
        assert_eq!(s.tool_usage_7d.get("Bash").copied(), Some(4));
        assert_eq!(s.tool_errors.get("Bash").copied(), Some(2));
        assert_eq!(s.tool_errors_7d.get("Bash").copied(), Some(1));
        assert!(s.by_project.contains_key("/repo/archived"));
        assert!(!s.by_project_7d.contains_key("/repo/archived"));
        assert!(s.by_project_7d.contains_key("/repo/atlas"));
    }

    #[test]
    fn recent_sessions_are_newest_first_capped_and_carry_no_transcript_path() {
        let mut records: Vec<SessionRecord> = (0..60)
            .map(|i| {
                let mut r = rec(&format!("s{i:02}"), "2026-01-01T00:00:00Z");
                r.last_timestamp = Some(format!("2026-02-{:02}T00:00:00Z", (i % 28) + 1));
                r
            })
            .collect();
        records[0].last_timestamp = Some("2026-03-01T00:00:00Z".to_string());
        records[0].by_model = HashMap::from([
            ("Sonnet".to_string(), ModelSessionData { output_tokens: 5, ..Default::default() }),
            ("Opus".to_string(), ModelSessionData { output_tokens: 500, ..Default::default() }),
        ]);

        let s = aggregate(&records);
        assert_eq!(s.recent_sessions.len(), RECENT_SESSION_LIMIT, "capped at 50");
        assert_eq!(s.recent_sessions[0].session_id, "s00", "newest first");
        assert_eq!(
            s.recent_sessions[0].model.as_deref(),
            Some("Opus"),
            "dominant family is the one with the most output tokens"
        );

        // The projection must not leak the absolute transcript path.
        let json = serde_json::to_string(&s.recent_sessions).unwrap();
        assert!(!json.contains(".jsonl"), "no transcript path crosses IPC");
        assert!(!json.contains("/fake/"), "no transcript path crosses IPC");
    }

    #[test]
    fn a_stale_cache_version_forces_a_full_reparse() {
        let current = StatsFile {
            version: STATS_FILE_VERSION,
            generated_at: "2026-01-01T00:00:00Z".to_string(),
            summary: StatsSummary::default(),
            sessions: vec![rec("cached", "2026-01-01T00:00:00Z")],
        };
        let json = serde_json::to_string(&current).unwrap();
        assert_eq!(
            cache_from_json(&json).len(),
            1,
            "a file at the current version is reused"
        );

        // A v3 file - the shape shipped before this phase - must be discarded
        // whole rather than deserializing its missing fields to defaults.
        let stale = json.replacen(
            &format!("\"version\":{STATS_FILE_VERSION}"),
            "\"version\":3",
            1,
        );
        assert!(stale.contains("\"version\":3"), "the fixture was actually downgraded");
        assert!(
            cache_from_json(&stale).is_empty(),
            "a v3 stats.json is dropped, forcing every session to be re-parsed"
        );

        assert!(cache_from_json("not json at all").is_empty());
    }

    #[test]
    fn aggregate_populates_by_week() {
        // Two sessions in the same ISO week, one using Opus, one using Sonnet
        let week_ts_1 = "2026-01-05T10:00:00Z"; // 2026-W02
        let week_ts_2 = "2026-01-06T10:00:00Z"; // 2026-W02 as well
        let make_rec = |id: &str, ts: &str, family: &str| SessionRecord {
            session_id: id.to_string(),
            path: format!("/fake/{id}.jsonl"),
            mtime: 0,
            size: 0,
            title: None,
            cwd: Some("/tmp".to_string()),
            git_branch: None,
            version: None,
            first_timestamp: Some(ts.to_string()),
            last_timestamp: Some(ts.to_string()),
            duration_secs: 60,
            user_messages: 2,
            user_chars: 10,
            assistant_messages: 1,
            peak_context: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cost_estimate: 0.0,
            subagents: 0,
            tool_calls: HashMap::new(),
            tool_errors: 0,
            tool_errors_by_name: HashMap::new(),
            by_model: {
                let mut m = HashMap::new();
                m.insert(family.to_string(), ModelSessionData::default());
                m
            },
            by_model_subagents: HashMap::new(),
            subagent_invocations: HashMap::new(),
        };
        let records = vec![
            make_rec("s1", week_ts_1, "Opus"),
            make_rec("s2", week_ts_2, "Sonnet"),
        ];
        let summary = aggregate(&records);
        let ws = summary.by_week.get("2026-W02").expect("2026-W02 key should exist");
        assert_eq!(ws.sessions, 2);
        assert_eq!(ws.by_model.get("Opus").copied(), Some(1));
        assert_eq!(ws.by_model.get("Sonnet").copied(), Some(1));
    }

    #[test]
    fn by_model_windows_filter_on_session_start() {
        // A recent Sonnet session and a months-old Opus session: all-time has both,
        // but the 7d/30d windows only include the recent one.
        let now = chrono::Utc::now();
        let recent = (now - chrono::Duration::days(2)).to_rfc3339();
        let old = (now - chrono::Duration::days(120)).to_rfc3339();
        let make_rec = |id: &str, ts: &str, family: &str| SessionRecord {
            session_id: id.to_string(),
            path: format!("/fake/{id}.jsonl"),
            mtime: 0,
            size: 0,
            title: None,
            cwd: Some("/tmp".to_string()),
            git_branch: None,
            version: None,
            first_timestamp: Some(ts.to_string()),
            last_timestamp: Some(ts.to_string()),
            duration_secs: 60,
            user_messages: 2,
            user_chars: 10,
            assistant_messages: 1,
            peak_context: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cost_estimate: 0.0,
            subagents: 0,
            tool_calls: HashMap::new(),
            tool_errors: 0,
            tool_errors_by_name: HashMap::new(),
            by_model: {
                let mut m = HashMap::new();
                m.insert(family.to_string(), ModelSessionData::default());
                m
            },
            by_model_subagents: HashMap::new(),
            subagent_invocations: HashMap::new(),
        };
        let records = vec![
            make_rec("recent", &recent, "Sonnet"),
            make_rec("old", &old, "Opus"),
        ];
        let summary = aggregate(&records);

        assert!(summary.by_model.contains_key("Opus"), "all-time keeps old Opus");
        assert!(summary.by_model.contains_key("Sonnet"), "all-time keeps recent Sonnet");

        assert!(summary.by_model_7d.contains_key("Sonnet"), "7d window has recent Sonnet");
        assert!(!summary.by_model_7d.contains_key("Opus"), "7d window drops 120-day-old Opus");

        assert!(summary.by_model_30d.contains_key("Sonnet"), "30d window has recent Sonnet");
        assert!(!summary.by_model_30d.contains_key("Opus"), "30d window drops 120-day-old Opus");
    }
}
