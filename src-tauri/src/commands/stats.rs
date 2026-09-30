use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, PoisonError};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use crate::session::omp;
use crate::transcript::{
    assistant_model, jsonl_lines, line_type, model_family, request_key, requests_to_by_model,
    tool_results, tool_uses, user_text, ModelSessionData, ReqData,
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

/// `~/.claude/projects`, resolved through symlinks when it exists. notify's
/// macOS backend reports real paths, so with `~/.claude` symlinked (common with
/// dotfile managers) the watchers would never match a transcript path built
/// from the unresolved name.
pub fn claude_projects_dir() -> Result<PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?
        .join(".claude")
        .join("projects");
    Ok(crate::transcript::resolve_symlinks(dir))
}

fn stats_path() -> Result<PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?
        .join(".atlas");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("stats.json"))
}

// ── Version ───────────────────────────────────────────────────────────────────

const STATS_FILE_VERSION: u32 = 7;

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
    /// Which harness wrote this transcript — `None` for Claude Code, `Some("omp")`
    /// for OMP. Absent from a file written before OMP was tracked here.
    #[serde(default)]
    pub harness: Option<String>,
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

    for line in jsonl_lines(reader) {
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
        let new_tools: Vec<String> = tool_uses(msg).iter().map(|t| t.name.to_string()).collect();
        let entry = requests
            .entry(req_key)
            .or_insert_with(|| ReqData::from_message(model, msg));
        entry.tool_names.extend(new_tools);
    }

    requests_to_by_model(requests)
}

pub(crate) fn merge_model_data(
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
                .map(|t| {
                    t.duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0)
                })
                .unwrap_or(0);
            (mtime, m.len())
        })
        .unwrap_or((0, 0))
}

/// The regular `*.jsonl` files in a session's `<dir>/<session id>/subagents/`
/// directory, by name. A directory that only looks like a transcript is not one.
fn subagent_files(transcript: &Path, session_id: &str) -> Vec<PathBuf> {
    let Some(dir) = transcript
        .parent()
        .map(|p| p.join(session_id).join("subagents"))
    else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .collect();
    files.sort();
    files
}

pub(crate) fn parse_session(path: &Path) -> Result<SessionRecord, String> {
    let (mtime, size) = file_mtime_size(path);
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // Subagent transcripts live in the sibling <session_id>/subagents/ directory
    let subagent_paths = subagent_files(path, &session_id);
    let subagents = subagent_paths.len() as u32;

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

    for line in jsonl_lines(reader) {
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
                    if !is_meta && is_human_authored(&obj, &s) {
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

    for sub_path in &subagent_paths {
        let sub_usage = parse_model_usage(sub_path);
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
        harness: None,
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
        if !project_entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let Ok(session_entries) = std::fs::read_dir(project_entry.path()) else {
            continue;
        };
        for session_entry in session_entries.flatten() {
            let path = session_entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                && session_entry
                    .file_type()
                    .map(|t| t.is_file())
                    .unwrap_or(false)
            {
                files.push(path);
            }
        }
    }
    files
}

fn omp_sessions_dir() -> Option<PathBuf> {
    omp::agent_dir().map(|d| d.join("sessions"))
}

/// Walk `~/.omp/agent/sessions/` and return paths of all session `*.jsonl`
/// files (direct children of the slug subdirs, not a `task` call's own
/// `<uuid>/<name>.jsonl` subagent files).
fn collect_omp_session_files(sessions_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(slug_entries) = std::fs::read_dir(sessions_dir) else {
        return files;
    };
    for slug_entry in slug_entries.flatten() {
        if !slug_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(session_entries) = std::fs::read_dir(slug_entry.path()) else {
            continue;
        };
        for session_entry in session_entries.flatten() {
            let path = session_entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                && session_entry
                    .file_type()
                    .map(|t| t.is_file())
                    .unwrap_or(false)
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

/// Serializes the sequence "read stats.json, scan the transcripts, write
/// stats.json". It guards no data, so a poisoned lock (a panic while it was
/// held) carries no meaning and is recovered from; treating it as an error
/// would fail every later recompute for the life of the process.
static RECOMPUTE_LOCK: Mutex<()> = Mutex::new(());

/// The reusable half of an on-disk stats.json, keyed by transcript path, and
/// whether the file was usable at all.
struct LoadedCache {
    records: HashMap<String, SessionRecord>,
    /// A file at the current version was read. False when the file is missing,
    /// from another version or unparseable, in which case it must be rewritten.
    current: bool,
}

/// Just enough of stats.json to name a file of another version.
#[derive(Deserialize)]
struct FileHeader {
    version: u32,
}

/// `path` with `suffix` appended to its file name: `stats.json` + `.bak`.
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Keep a copy of a stats.json that is about to be replaced. Claude Code prunes
/// old transcripts, so this file can be the only record of the sessions they
/// held, and the caller is about to overwrite it with what a rescan finds.
fn back_up(path: &Path, suffix: &str) {
    let backup = sibling(path, suffix);
    match std::fs::copy(path, &backup) {
        Ok(_) => log::warn!(
            "{} cannot be reused; a copy was kept as {}",
            path.display(),
            backup.display()
        ),
        Err(e) => log::warn!(
            "{} cannot be reused and could not be copied to {}: {}",
            path.display(),
            backup.display(),
            e
        ),
    }
}

/// Read stats.json for reuse.
///
/// Only a file written by *this* `STATS_FILE_VERSION` is reused. An older file
/// would deserialize with `Default`s for every field added since, so the numbers
/// would be silently wrong rather than merely missing — an unrecognised version
/// must force a full re-parse instead. Such a file, and a corrupt one, is copied
/// to `stats.json.v<N>.bak` / `stats.json.bak` first, because the re-parse cannot
/// bring back sessions whose transcripts are gone.
fn load_cache(stats_path: &Path) -> LoadedCache {
    let unusable = || LoadedCache {
        records: HashMap::new(),
        current: false,
    };
    let json = match std::fs::read_to_string(stats_path) {
        Ok(json) => json,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return unusable(),
        Err(_) => {
            back_up(stats_path, ".bak");
            return unusable();
        }
    };
    if let Ok(file) = serde_json::from_str::<StatsFile>(&json) {
        if file.version == STATS_FILE_VERSION {
            return LoadedCache {
                records: file
                    .sessions
                    .into_iter()
                    .map(|s| (s.path.clone(), s))
                    .collect(),
                current: true,
            };
        }
    }
    let suffix = match serde_json::from_str::<FileHeader>(&json) {
        Ok(header) if header.version != STATS_FILE_VERSION => format!(".v{}.bak", header.version),
        _ => ".bak".to_string(),
    };
    back_up(stats_path, &suffix);
    unusable()
}

/// Create `path` readable by its owner alone: stats.json holds absolute
/// transcript paths, project directories, branch names and session titles.
fn create_private(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Replace `path` with `contents` so a reader (or a crash) sees the old file or
/// the new one, never a truncated half: write a sibling, flush it to disk, then
/// rename over the target.
fn write_atomically(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = sibling(path, ".tmp");
    let result = create_private(&tmp).and_then(|mut file| {
        file.write_all(contents)?;
        file.sync_all()
    });
    let result = result.and_then(|()| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Walk all session files, re-parse changed ones, aggregate, write stats.json.
pub fn recompute() -> Result<StatsSummary, String> {
    let _guard = RECOMPUTE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    recompute_in(
        &claude_projects_dir()?,
        omp_sessions_dir().as_deref(),
        &stats_path()?,
    )
}

/// `recompute` over explicit locations, so the cache logic can be exercised
/// against a temp directory.
fn recompute_in(
    projects_dir: &Path,
    omp_dir: Option<&Path>,
    stats_path: &Path,
) -> Result<StatsSummary, String> {
    if !projects_dir.exists() {
        return Ok(StatsSummary::default());
    }

    let LoadedCache {
        records: mut cache,
        current: cache_was_current,
    } = load_cache(stats_path);

    let mut session_files = collect_session_files(projects_dir);
    if let Some(omp_dir) = omp_dir.filter(|dir| dir.exists()) {
        session_files.extend(collect_omp_session_files(omp_dir));
    }
    let mut records: Vec<SessionRecord> = Vec::with_capacity(session_files.len());
    // Whether anything differs from what stats.json already holds.
    let mut changed = false;

    for path in &session_files {
        let path_str = path.to_string_lossy().to_string();
        let (mtime, size) = file_mtime_size(path);

        // Moved out of the cache rather than cloned: whatever is left in it
        // afterwards is a record whose file is gone.
        let stale = match cache.remove(&path_str) {
            Some(cached) if cached.mtime == mtime && cached.size == size => {
                records.push(cached);
                continue;
            }
            stale => stale,
        };

        let parsed = if path.starts_with(projects_dir) {
            parse_session(path)
        } else {
            omp::parse_omp_session(path)
        };
        match parsed {
            Ok(rec) => {
                changed = true;
                records.push(rec);
            }
            Err(e) => {
                log::warn!("Failed to parse session {}: {}", path.display(), e);
                // A file that vanished or turned unreadable between the listing
                // and the read still has its earlier numbers; dropping them
                // would lose the session from the history for good.
                records.extend(stale);
            }
        }
    }

    // Keep cached records whose source .jsonl has since been deleted (e.g. by the
    // CLI's own transcript retention cleanup) — otherwise historical stats vanish
    // from Atlas's cache the moment the underlying file is pruned. Not when the
    // same session is present under another path (a moved or renamed project
    // directory), which would count it twice.
    let live: HashSet<(bool, &str)> = records
        .iter()
        .map(|r| (r.harness.is_some(), r.session_id.as_str()))
        .collect();
    let kept: Vec<SessionRecord> = cache
        .into_values()
        .filter(|cached| {
            let duplicate = live.contains(&(cached.harness.is_some(), cached.session_id.as_str()));
            changed |= duplicate;
            !duplicate
        })
        .collect();
    records.extend(kept);
    records.sort_by(|a, b| a.path.cmp(&b.path));

    let summary = aggregate(&records);

    if changed || !cache_was_current {
        let file = StatsFile {
            version: STATS_FILE_VERSION,
            generated_at: summary.generated_at.clone(),
            summary: summary.clone(),
            sessions: records,
        };
        match serde_json::to_vec(&file) {
            Ok(json) => {
                if let Err(e) = write_atomically(stats_path, &json) {
                    log::warn!("Failed to write stats.json: {}", e);
                }
            }
            Err(e) => log::warn!("Failed to serialize stats: {}", e),
        }
    }

    Ok(summary)
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_claude_stats() -> Result<StatsSummary, String> {
    tokio::task::spawn_blocking(recompute)
        .await
        .map_err(|e| e.to_string())?
}

// ── Resumable sessions ────────────────────────────────────────────────────────

/// One prior conversation the New Session modal can hand to `claude --resume`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResumableSession {
    /// The transcript uuid — exactly what `--resume` takes.
    pub session_id: String,
    pub title: Option<String>,
    pub git_branch: Option<String>,
    pub last_timestamp: Option<String>,
    pub user_messages: u32,
}

/// How many prior sessions one workspace offers.
const RESUMABLE_LIMIT: usize = 25;

/// Fold a filesystem path into a comparable key.
///
/// A transcript's `cwd` is written by the Claude Code process; a workspace path
/// is written by the folder picker. For the same directory the two routinely
/// differ in separator style, drive-letter case and trailing separator on
/// Windows, so the Resume list must compare the folded form and never the raw
/// strings. Case is folded only where the filesystem is case-insensitive — on
/// Linux `/A` and `/a` really are different directories.
fn normalize_path(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let trimmed = unified.trim_end_matches('/');
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

/// The pure half of `list_resumable_sessions`: the records for one workspace,
/// newest first, capped.
fn resumable_for_cwd(records: &[SessionRecord], cwd: &str) -> Vec<ResumableSession> {
    let want = normalize_path(cwd);
    let mut matched: Vec<&SessionRecord> = records
        .iter()
        .filter(|r| {
            r.harness.is_none() && r.cwd.as_deref().is_some_and(|c| normalize_path(c) == want)
        })
        .collect();
    matched.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
    matched
        .into_iter()
        .take(RESUMABLE_LIMIT)
        .map(|r| ResumableSession {
            session_id: r.session_id.clone(),
            title: r.title.clone(),
            git_branch: r.git_branch.clone(),
            last_timestamp: r.last_timestamp.clone(),
            user_messages: r.user_messages,
        })
        .collect()
}

/// Parsed sessions straight off stats.json. Empty when the file is missing or
/// was written by another `STATS_FILE_VERSION`.
fn cached_sessions() -> Vec<SessionRecord> {
    let Ok(path) = stats_path() else {
        return Vec::new();
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<StatsFile>(&s).ok())
        .filter(|f| f.version == STATS_FILE_VERSION)
        .map(|f| f.sessions)
        .unwrap_or_default()
}

/// Prior conversations in `cwd`, for the New Session modal's Resume list.
///
/// Sourced from the transcript cache the stats watcher already maintains.
/// `claude --resume` itself is never shelled out to: it opens an interactive
/// picker and prints nothing machine-readable.
#[tauri::command]
pub async fn list_resumable_sessions(cwd: String) -> Result<Vec<ResumableSession>, String> {
    tokio::task::spawn_blocking(move || {
        let mut records = cached_sessions();
        // A first launch can reach the modal before the startup recompute has
        // written stats.json; an empty list there would read as "no history"
        // rather than "not indexed yet".
        if records.is_empty() {
            recompute()?;
            records = cached_sessions();
        }
        Ok(resumable_for_cwd(&records, &cwd))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Watcher ───────────────────────────────────────────────────────────────────

/// A transcript write worth a recompute. That includes a subagent's own file,
/// which is part of its session's totals; the watched roots already limit this
/// to Claude Code and OMP transcripts.
fn is_session_jsonl(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("jsonl")
}

/// Holds the stats watcher alive for the life of the app. `Manager::manage` is
/// keyed by type, so a bare `RecommendedWatcher` here would collide with the
/// panel watcher's and be dropped on registration — taking `stats-update` with it.
pub struct StatsWatcher(
    // Held only so the watcher is dropped with app state, never read through this handle.
    #[allow(dead_code)] RecommendedWatcher,
);

/// Groups a burst of transcript writes into one recompute that runs after the
/// burst, so the last writes of a turn (its final assistant line, the title,
/// the closing tool result) are in the numbers instead of being dropped by a
/// window that only ever looked at the first.
///
/// A recompute runs once `QUIET` has passed with no further write, or `MAX_WAIT`
/// after the first unhandled one if writes never stop (a long tool loop), so the
/// dashboard keeps moving during continuous activity.
#[derive(Default)]
struct Coalesce {
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Coalesce {
    const QUIET: Duration = Duration::from_millis(400);
    const MAX_WAIT: Duration = Duration::from_millis(2000);

    fn write(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    /// When the pending writes are due to be handled; `None` with none pending.
    fn due_at(&self) -> Option<Instant> {
        Some((self.last? + Self::QUIET).min(self.first? + Self::MAX_WAIT))
    }

    /// True (and the pending writes are consumed) once they are due.
    fn take_if_due(&mut self, now: Instant) -> bool {
        if self.due_at().is_some_and(|at| at <= now) {
            *self = Coalesce::default();
            return true;
        }
        false
    }
}

pub fn start_stats_watcher(app_handle: AppHandle) -> Result<StatsWatcher, String> {
    let projects_dir = claude_projects_dir()?;
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| match res {
            Ok(event) => {
                let _ = tx.send(event);
            }
            Err(e) => log::warn!("stats watcher error: {}", e),
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(500)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&projects_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // OMP is optional: failing to watch its directory must not disable the
    // Claude Code stats.
    if let Some(omp_dir) = omp_sessions_dir().filter(|dir| dir.exists()) {
        if let Err(e) = watcher.watch(&omp_dir, RecursiveMode::Recursive) {
            log::warn!("Failed to watch {}: {}", omp_dir.display(), e);
        }
    }

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let mut pending = Coalesce::default();

        loop {
            let received = match pending.due_at() {
                None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
                Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
            };
            match received {
                Ok(event) => {
                    let is_write =
                        matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_));
                    if is_write && event.paths.iter().any(|p| is_session_jsonl(p)) {
                        pending.write(Instant::now());
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if pending.take_if_due(Instant::now()) {
                match recompute() {
                    Ok(summary) => {
                        let _ = handle.emit("stats-update", &summary);
                    }
                    Err(e) => log::warn!("Stats recompute failed: {}", e),
                }
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

    /// A persistent read error (here EISDIR: a directory named like a
    /// transcript) must end the read. `lines()` yields the same `Err` forever.
    #[cfg(unix)]
    #[test]
    fn a_directory_named_like_a_transcript_does_not_hang_the_parser() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent.jsonl");
        std::fs::create_dir(&path).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(parse_model_usage(&path).len());
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)), Ok(0));
    }

    /// Invalid UTF-8 costs the line it sits on, not the rest of the file.
    #[test]
    fn a_line_of_invalid_utf8_is_skipped_not_fatal() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut f, b"\xff\xfe not utf8\n").unwrap();
        std::io::Write::write_all(
            &mut f,
            br#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
        )
        .unwrap();
        std::io::Write::write_all(&mut f, b"\n").unwrap();
        assert_eq!(parse_session(f.path()).unwrap().user_messages, 1);
    }

    #[test]
    fn counts_typed_prompts_including_ones_with_an_image() {
        let f = write_lines(&[
            r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","is_error":false}]},"timestamp":"2026-01-01T00:01:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"sys"},"timestamp":"2026-01-01T00:02:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Image #1] see"},{"type":"image","source":{}}]},"timestamp":"2026-01-01T00:03:00Z","cwd":"/tmp"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},"timestamp":"2026-01-01T00:04:00Z","cwd":"/tmp"}"#,
        ]);
        let rec = parse_session(f.path()).unwrap();
        assert_eq!(
            rec.user_messages, 2,
            "the string prompt and the image prompt"
        );
        assert_eq!(
            rec.user_chars,
            "hello".len() as u64 + "[Image #1] see".len() as u64
        );
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
        let f =
            write_lines(&[r#"{"type":"ai-title","aiTitle":"My session title","sessionId":"abc"}"#]);
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
        assert_eq!(
            rec.user_chars, 7,
            "only counts chars from plain-string non-meta messages"
        );
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
        assert_eq!(
            rec.by_model["Sonnet"].user_chars, 2,
            "Sonnet only answered the 2-char message"
        );
        assert_eq!(rec.by_model["Sonnet"].user_messages, 1);
        assert_eq!(
            rec.by_model["Opus"].user_chars, 36,
            "Opus only answered the 36-char message"
        );
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
        assert_eq!(
            rec.by_model["Opus"].user_chars, 0,
            "subagent prompts aren't counted as human messages"
        );
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
            harness: None,
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
        assert_eq!(
            rec.tool_errors, 2,
            "both errored results still count session-wide"
        );
        assert_eq!(rec.tool_errors_by_name.get("Bash").copied(), Some(1));
        assert_eq!(rec.tool_errors_by_name.get("Read").copied(), None);
        assert_eq!(
            rec.tool_errors_by_name.len(),
            1,
            "the orphan id is charged to no tool"
        );
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
        assert!(
            (ps.cost - 4.0).abs() < 1e-9,
            "cost is summed across sessions"
        );
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

        assert_eq!(
            s.tool_usage.get("Bash").copied(),
            Some(8),
            "all-time sums both"
        );
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
            (
                "Sonnet".to_string(),
                ModelSessionData {
                    output_tokens: 5,
                    ..Default::default()
                },
            ),
            (
                "Opus".to_string(),
                ModelSessionData {
                    output_tokens: 500,
                    ..Default::default()
                },
            ),
        ]);

        let s = aggregate(&records);
        assert_eq!(
            s.recent_sessions.len(),
            RECENT_SESSION_LIMIT,
            "capped at 50"
        );
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

    /// A stats.json tree in a temp dir: `projects/`, `stats.json`.
    struct Tree {
        dir: tempfile::TempDir,
    }

    impl Tree {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir_all(dir.path().join("projects")).unwrap();
            Tree { dir }
        }

        fn projects(&self) -> PathBuf {
            self.dir.path().join("projects")
        }

        fn stats(&self) -> PathBuf {
            self.dir.path().join("stats.json")
        }

        fn session(&self, project: &str, id: &str, lines: &[&str]) -> PathBuf {
            let dir = self.projects().join(project);
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("{id}.jsonl"));
            std::fs::write(&path, lines.join("\n") + "\n").unwrap();
            path
        }

        fn recompute(&self) -> StatsSummary {
            recompute_in(&self.projects(), None, &self.stats()).unwrap()
        }

        fn saved(&self) -> StatsFile {
            serde_json::from_str(&std::fs::read_to_string(self.stats()).unwrap()).unwrap()
        }
    }

    const PROMPT: &str = r#"{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp"}"#;

    #[test]
    fn a_truncated_stats_file_is_kept_as_a_backup_before_it_is_replaced() {
        let tree = Tree::new();
        tree.session("p", "a", &[PROMPT]);
        tree.recompute();
        let good = std::fs::read_to_string(tree.stats()).unwrap();

        // An interrupted write of the old, non-atomic kind.
        std::fs::write(tree.stats(), &good[..good.len() / 2]).unwrap();
        tree.recompute();

        assert_eq!(
            std::fs::read_to_string(sibling(&tree.stats(), ".bak")).unwrap(),
            &good[..good.len() / 2],
            "the unreadable file survives"
        );
        assert_eq!(tree.saved().sessions.len(), 1, "a fresh file replaced it");
    }

    #[test]
    fn a_file_from_another_version_is_kept_under_its_version() {
        let tree = Tree::new();
        tree.session("p", "a", &[PROMPT]);
        let old = StatsFile {
            version: STATS_FILE_VERSION - 1,
            generated_at: "2026-01-01T00:00:00Z".to_string(),
            summary: StatsSummary::default(),
            sessions: vec![rec("pruned", "2026-01-01T00:00:00Z")],
        };
        let old_json = serde_json::to_string(&old).unwrap();
        std::fs::write(tree.stats(), &old_json).unwrap();

        tree.recompute();

        let backup = sibling(&tree.stats(), &format!(".v{}.bak", STATS_FILE_VERSION - 1));
        assert_eq!(std::fs::read_to_string(backup).unwrap(), old_json);
        assert_eq!(tree.saved().version, STATS_FILE_VERSION);
    }

    #[test]
    fn a_current_file_is_reused_not_backed_up() {
        let tree = Tree::new();
        tree.session("p", "a", &[PROMPT]);
        tree.recompute();
        tree.recompute();
        assert!(!sibling(&tree.stats(), ".bak").exists());
    }

    #[test]
    fn a_pruned_transcript_keeps_its_record() {
        let tree = Tree::new();
        let path = tree.session("p", "a", &[PROMPT]);
        tree.session("p", "b", &[PROMPT]);
        tree.recompute();

        std::fs::remove_file(path).unwrap();
        let summary = tree.recompute();

        assert_eq!(summary.total_sessions, 2);
        assert_eq!(tree.saved().sessions.len(), 2);
    }

    /// A session moved to another project directory is the same session, not
    /// a second one next to the record of its old path.
    #[test]
    fn a_moved_transcript_is_not_counted_twice() {
        let tree = Tree::new();
        let path = tree.session("old", "a", &[PROMPT]);
        tree.recompute();

        std::fs::remove_file(&path).unwrap();
        tree.session("new", "a", &[PROMPT]);
        let summary = tree.recompute();

        assert_eq!(summary.total_sessions, 1);
        assert_eq!(tree.saved().sessions.len(), 1);
    }

    /// A transcript that cannot be read on this pass must not erase the
    /// numbers it had.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_changed_transcript_keeps_its_earlier_record() {
        use std::os::unix::fs::PermissionsExt;
        let tree = Tree::new();
        let path = tree.session("p", "a", &[PROMPT]);
        tree.recompute();

        std::fs::write(&path, format!("{PROMPT}\n{PROMPT}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::File::open(&path).is_ok() {
            return; // running as root: permissions do not apply
        }
        let summary = tree.recompute();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(summary.total_sessions, 1);
        assert_eq!(summary.total_user_messages, 1, "the record from before");
    }

    #[test]
    fn an_unchanged_tree_does_not_rewrite_stats_json() {
        let tree = Tree::new();
        tree.session("p", "a", &[PROMPT]);
        tree.recompute();

        let marker = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        std::fs::File::options()
            .write(true)
            .open(tree.stats())
            .unwrap()
            .set_modified(marker)
            .unwrap();
        tree.recompute();

        let modified = std::fs::metadata(tree.stats()).unwrap().modified().unwrap();
        assert_eq!(modified, marker);
    }

    #[cfg(unix)]
    #[test]
    fn stats_json_is_private_and_leaves_no_temp_file() {
        use std::os::unix::fs::PermissionsExt;
        let tree = Tree::new();
        tree.session("p", "a", &[PROMPT]);
        tree.recompute();

        let mode = std::fs::metadata(tree.stats())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert!(!sibling(&tree.stats(), ".tmp").exists());
    }

    /// A directory that merely looks like a subagent transcript is not one.
    #[cfg(unix)]
    #[test]
    fn a_directory_named_like_a_subagent_transcript_is_not_counted() {
        let tree = Tree::new();
        tree.session("p", "a", &[PROMPT]);
        std::fs::create_dir_all(tree.projects().join("p/a/subagents/x.jsonl")).unwrap();
        let summary = tree.recompute();
        assert_eq!(summary.total_subagents, 0);
    }

    /// The final write of a burst is the one users look at. It must produce a
    /// recompute after the burst, not be dropped because it landed soon after
    /// an earlier one.
    #[test]
    fn the_last_write_of_a_burst_is_handled_after_the_burst() {
        let t0 = Instant::now();
        let mut pending = Coalesce::default();
        assert_eq!(pending.due_at(), None);

        pending.write(t0);
        pending.write(t0 + Duration::from_millis(300));
        let last = t0 + Duration::from_millis(300);
        assert!(!pending.take_if_due(last), "still inside the quiet period");
        assert_eq!(pending.due_at(), Some(last + Coalesce::QUIET));

        assert!(pending.take_if_due(last + Coalesce::QUIET));
        assert_eq!(pending.due_at(), None, "consumed");
        assert!(!pending.take_if_due(last + Coalesce::QUIET));
    }

    #[test]
    fn continuous_writes_still_recompute_within_the_max_wait() {
        let t0 = Instant::now();
        let mut pending = Coalesce::default();
        for ms in (0..3000).step_by(100) {
            pending.write(t0 + Duration::from_millis(ms));
        }
        assert_eq!(pending.due_at(), Some(t0 + Coalesce::MAX_WAIT));
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
            harness: None,
        };
        let records = vec![
            make_rec("s1", week_ts_1, "Opus"),
            make_rec("s2", week_ts_2, "Sonnet"),
        ];
        let summary = aggregate(&records);
        let ws = summary
            .by_week
            .get("2026-W02")
            .expect("2026-W02 key should exist");
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
            harness: None,
        };
        let records = vec![
            make_rec("recent", &recent, "Sonnet"),
            make_rec("old", &old, "Opus"),
        ];
        let summary = aggregate(&records);

        assert!(
            summary.by_model.contains_key("Opus"),
            "all-time keeps old Opus"
        );
        assert!(
            summary.by_model.contains_key("Sonnet"),
            "all-time keeps recent Sonnet"
        );

        assert!(
            summary.by_model_7d.contains_key("Sonnet"),
            "7d window has recent Sonnet"
        );
        assert!(
            !summary.by_model_7d.contains_key("Opus"),
            "7d window drops 120-day-old Opus"
        );

        assert!(
            summary.by_model_30d.contains_key("Sonnet"),
            "30d window has recent Sonnet"
        );
        assert!(
            !summary.by_model_30d.contains_key("Opus"),
            "30d window drops 120-day-old Opus"
        );
    }

    // ── Phase 10: resumable sessions ───────────────────────────────────────

    fn rec_in(id: &str, ts: &str, cwd: &str) -> SessionRecord {
        SessionRecord {
            cwd: Some(cwd.to_string()),
            ..rec(id, ts)
        }
    }

    #[test]
    fn normalize_path_folds_separators_and_trailing_slash() {
        assert_eq!(
            normalize_path(r"C:\Users\jakeh\Documents\GitHub\Atlas"),
            normalize_path("C:/Users/jakeh/Documents/GitHub/Atlas/"),
        );
        assert_eq!(
            normalize_path("/repo/atlas/"),
            normalize_path("/repo/atlas")
        );
    }

    #[cfg(windows)]
    #[test]
    fn normalize_path_folds_case_on_windows() {
        // The folder picker and the transcript disagree on drive-letter case
        // for the same directory; both must land on the same key.
        assert_eq!(
            normalize_path(r"c:\users\jakeh\documents\github\atlas"),
            normalize_path(r"C:\Users\jakeh\Documents\GitHub\Atlas"),
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn normalize_path_keeps_case_off_windows() {
        assert_ne!(normalize_path("/repo/Atlas"), normalize_path("/repo/atlas"));
    }

    #[test]
    fn resumable_matches_a_workspace_whose_separators_differ_from_the_transcript() {
        let records = vec![rec_in("a", "2026-01-01T00:00:00Z", r"C:\repo\atlas")];
        let found = resumable_for_cwd(&records, "C:/repo/atlas/");
        assert_eq!(
            found.len(),
            1,
            "backslash cwd matches a forward-slash workspace"
        );
        assert_eq!(found[0].session_id, "a");
    }

    #[test]
    fn resumable_is_filtered_by_cwd_newest_first_and_capped() {
        let mut records = Vec::new();
        for i in 0..30 {
            records.push(rec_in(
                &format!("s{i:02}"),
                &format!("2026-01-{:02}T00:00:00Z", i + 1),
                "/repo/atlas",
            ));
        }
        records.push(rec_in("other", "2026-12-31T00:00:00Z", "/repo/elsewhere"));

        let found = resumable_for_cwd(&records, "/repo/atlas");
        assert_eq!(found.len(), RESUMABLE_LIMIT, "capped at 25");
        assert_eq!(found[0].session_id, "s29", "newest first");
        assert!(
            found.iter().all(|r| r.session_id != "other"),
            "another workspace's sessions never leak in",
        );
        assert_eq!(
            found[0].user_messages, 2,
            "message count comes from the record"
        );
        assert_eq!(found[0].git_branch.as_deref(), Some("main"));
    }

    #[test]
    fn resumable_is_empty_for_a_workspace_with_no_history() {
        let records = vec![rec_in("a", "2026-01-01T00:00:00Z", "/repo/atlas")];
        assert!(resumable_for_cwd(&records, "/repo/brand-new").is_empty());
    }

    #[test]
    fn resumable_ignores_records_with_no_cwd() {
        let records = vec![SessionRecord {
            cwd: None,
            ..rec("a", "2026-01-01T00:00:00Z")
        }];
        assert!(resumable_for_cwd(&records, "/repo/atlas").is_empty());
    }

    // ── OMP ───────────────────────────────────────────────────────────────

    #[test]
    fn parse_omp_session_reads_usage_tools_and_subagents() {
        let f = write_lines(&[
            r#"{"type":"session","id":"omp-sess-1","cwd":"/repo/atlas","timestamp":"2026-01-01T00:00:00Z"}"#,
            r#"{"type":"message","timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hello there"}],"attribution":"user"}}"#,
            r#"{"type":"message","timestamp":"2026-01-01T00:00:05Z","message":{"role":"assistant","model":"anthropic/claude-sonnet-5","stopReason":"toolUse","content":[{"type":"toolCall","id":"t1","name":"bash","arguments":{"command":"ls"}}],"usage":{"input":100,"output":50,"cacheRead":10,"cacheWrite":0,"totalTokens":160,"cost":{"total":0.02}}}}"#,
            r#"{"type":"message","timestamp":"2026-01-01T00:00:06Z","message":{"role":"toolResult","toolCallId":"t1","toolName":"bash","isError":true,"content":[{"type":"text","text":"boom"}]}}"#,
            r#"{"type":"message","timestamp":"2026-01-01T00:00:10Z","message":{"role":"assistant","model":"anthropic/claude-sonnet-5","stopReason":"toolUse","content":[{"type":"toolCall","id":"t2","name":"task","arguments":{"tasks":[{"name":"Scout1","agent":"scout","task":"look"}]}}],"usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"cost":{"total":0.01}}}}"#,
        ]);

        let rec = omp::parse_omp_session(f.path()).unwrap();
        assert_eq!(rec.session_id, "omp-sess-1");
        assert_eq!(rec.cwd.as_deref(), Some("/repo/atlas"));
        assert_eq!(rec.user_messages, 1);
        assert_eq!(rec.user_chars, 11, "\"hello there\" is 11 chars");
        assert_eq!(rec.assistant_messages, 2);
        assert_eq!(rec.output_tokens, 55);
        assert!((rec.cost_estimate - 0.03).abs() < 1e-9);
        assert_eq!(rec.tool_calls.get("bash").copied(), Some(1));
        assert_eq!(rec.tool_calls.get("task").copied(), Some(1));
        assert_eq!(rec.tool_errors, 1);
        assert_eq!(rec.tool_errors_by_name.get("bash").copied(), Some(1));
        assert_eq!(rec.subagents, 1);
        assert_eq!(rec.peak_context, 110);
        assert_eq!(rec.harness.as_deref(), Some("omp"));

        assert!(
            resumable_for_cwd(&[rec], "/repo/atlas").is_empty(),
            "an omp session must not offer claude --resume"
        );
    }
}
