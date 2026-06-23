use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ── Pricing ──────────────────────────────────────────────────────────────────

struct Pricing {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

/// Approximate API-equivalent pricing per million tokens.
/// Prices are labelled as approximate in the UI; labelled per Anthropic pricing as of 2026-06.
fn pricing_for(model: &str) -> Pricing {
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

fn model_family(model: &str) -> String {
    let m = model.to_ascii_lowercase();
    if m.contains("opus") { "Opus".to_string() }
    else if m.contains("fable") { "Fable".to_string() }
    else if m.contains("sonnet") { "Sonnet".to_string() }
    else if m.contains("haiku") { "Haiku".to_string() }
    else { model.to_string() }
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

const STATS_FILE_VERSION: u32 = 3;

// ── Data model ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelSessionData {
    pub assistant_msgs: u32,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cost_estimate: f64,
    pub tool_calls: u32,
    pub peak_context: u64,
}

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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub sessions: u32,
    pub output_tokens: u64,
    pub user_messages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub sessions: u32,
    pub output_tokens: u64,
    pub user_messages: u32,
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
    pub by_project: HashMap<String, ProjectStats>,
    pub by_day: HashMap<String, DayStats>,
    pub by_week: HashMap<String, WeekStats>,
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

/// One API request's accumulated data. Multiple assistant lines share a requestId.
struct ReqData {
    model: String,
    input_tokens: u64,
    cache_read: u64,
    cache_create: u64,
    output_tokens: u64,
    tool_names: Vec<String>,
}

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
        if obj.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let msg = obj.get("message").unwrap_or(&Value::Null);
        let model = msg.get("model").and_then(|v| v.as_str()).unwrap_or("");
        if model.is_empty() || model == "<synthetic>" {
            continue;
        }
        let req_key = obj
            .get("requestId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| obj.get("uuid").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();
        if req_key.is_empty() {
            continue;
        }
        let mut new_tools: Vec<String> = Vec::new();
        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            for item in content {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    new_tools.push(name);
                }
            }
        }
        let entry = requests.entry(req_key).or_insert_with(|| {
            let usage = msg.get("usage").unwrap_or(&Value::Null);
            ReqData {
                model: model.to_string(),
                input_tokens: usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                cache_read: usage
                    .get("cache_read_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                cache_create: usage
                    .get("cache_creation_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                output_tokens: usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                tool_names: Vec::new(),
            }
        });
        entry.tool_names.extend(new_tools);
    }

    requests_to_by_model(requests)
}

fn requests_to_by_model(requests: HashMap<String, ReqData>) -> HashMap<String, ModelSessionData> {
    let mut by_model: HashMap<String, ModelSessionData> = HashMap::new();
    for data in requests.values() {
        let ctx = data.input_tokens + data.cache_read + data.cache_create;
        let p = pricing_for(&data.model);
        let cost = (data.input_tokens as f64 * p.input
            + data.cache_create as f64 * p.cache_write
            + data.cache_read as f64 * p.cache_read
            + data.output_tokens as f64 * p.output)
            / 1_000_000.0;
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

fn parse_session(path: &Path) -> Result<SessionRecord, String> {
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

        let line_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match line_type {
            "user" => {
                let is_meta = obj.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
                let content = obj
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .unwrap_or(&Value::Null);
                if !is_meta && content.is_string() {
                    user_messages += 1;
                    user_chars += content.as_str().map(|s| s.chars().count()).unwrap_or(0) as u64;
                } else if let Some(arr) = content.as_array() {
                    for item in arr {
                        if item.get("type").and_then(|v| v.as_str()) == Some("tool_result")
                            && item.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false)
                        {
                            tool_errors += 1;
                        }
                    }
                }
            }
            "assistant" => {
                let msg = obj.get("message").unwrap_or(&Value::Null);
                let model = msg.get("model").and_then(|v| v.as_str()).unwrap_or("");
                if model.is_empty() || model == "<synthetic>" {
                    continue;
                }

                // Use requestId as key; fall back to uuid if absent
                let req_key = obj
                    .get("requestId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .or_else(|| obj.get("uuid").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                if req_key.is_empty() {
                    continue;
                }

                // Collect tool_use names from this line's content (across all lines for same req)
                let mut new_tools: Vec<String> = Vec::new();
                if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
                    for item in content {
                        if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            let name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            new_tools.push(name);
                        }
                    }
                }

                let entry = requests.entry(req_key).or_insert_with(|| {
                    let usage = msg.get("usage").unwrap_or(&Value::Null);
                    ReqData {
                        model: model.to_string(),
                        input_tokens: usage
                            .get("input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cache_read: usage
                            .get("cache_read_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        cache_create: usage
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        output_tokens: usage
                            .get("output_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        tool_names: Vec::new(),
                    }
                });
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
        let ctx = data.input_tokens + data.cache_read + data.cache_create;
        if ctx > peak_context {
            peak_context = ctx;
        }
        output_tokens += data.output_tokens;
        cache_creation_tokens += data.cache_create;
        let p = pricing_for(&data.model);
        cost_estimate += (data.input_tokens as f64 * p.input
            + data.cache_create as f64 * p.cache_write
            + data.cache_read as f64 * p.cache_read
            + data.output_tokens as f64 * p.output)
            / 1_000_000.0;
        for name in &data.tool_names {
            *tool_calls.entry(name.clone()).or_insert(0) += 1;
        }
    }

    let assistant_messages = requests.len() as u32;
    let by_model = requests_to_by_model(requests);

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
        ms.user_messages += rec.user_messages as u64;
        ms.user_chars += rec.user_chars;
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

    let mut peak_sum: u64 = 0;
    let mut versions_set: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Intermediate by_model accumulators (without derived fields): all-time + windows
    let mut model_acc: HashMap<String, ModelStats> = HashMap::new();
    let mut model_acc_30d: HashMap<String, ModelStats> = HashMap::new();
    let mut model_acc_7d: HashMap<String, ModelStats> = HashMap::new();
    let mut subagent_acc: HashMap<String, ModelStats> = HashMap::new();
    let mut subagent_acc_30d: HashMap<String, ModelStats> = HashMap::new();
    let mut subagent_acc_7d: HashMap<String, ModelStats> = HashMap::new();

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

        for (tool, count) in &rec.tool_calls {
            *summary.tool_usage.entry(tool.clone()).or_insert(0) += count;
        }

        // Per project
        if let Some(cwd) = &rec.cwd {
            let ps = summary.by_project.entry(cwd.clone()).or_default();
            ps.sessions += 1;
            ps.output_tokens += rec.output_tokens;
            ps.user_messages += rec.user_messages;
        }

        // Per day
        if let Some(ts) = &rec.first_timestamp {
            let day = ts.get(..10).unwrap_or("").to_string();
            if !day.is_empty() {
                let ds = summary.by_day.entry(day).or_default();
                ds.sessions += 1;
                ds.output_tokens += rec.output_tokens;
                ds.user_messages += rec.user_messages;
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
            }
            if dt >= cutoff_7d {
                accumulate_model(&mut model_acc_7d, rec);
                accumulate_subagent_model(&mut subagent_acc_7d, rec);
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

/// Walk all session files, re-parse changed ones, aggregate, write stats.json.
pub fn recompute() -> Result<StatsSummary, String> {
    let _guard = RECOMPUTE_LOCK.lock().map_err(|e| e.to_string())?;

    let projects_dir = claude_projects_dir()?;
    if !projects_dir.exists() {
        return Ok(StatsSummary::default());
    }

    let stats_path = stats_path()?;

    // Load existing cache — only reuse when the file version matches; a version bump
    // forces a full re-parse so new fields (e.g. user_chars) are back-filled.
    let cache: HashMap<String, SessionRecord> = std::fs::read_to_string(&stats_path)
        .ok()
        .and_then(|s| serde_json::from_str::<StatsFile>(&s).ok())
        .filter(|f| f.version == STATS_FILE_VERSION)
        .map(|f| f.sessions.into_iter().map(|s| (s.path.clone(), s)).collect())
        .unwrap_or_default();

    let session_files = collect_session_files(&projects_dir);
    let mut records: Vec<SessionRecord> = Vec::with_capacity(session_files.len());

    for path in &session_files {
        let path_str = path.to_string_lossy().to_string();
        let (mtime, size) = file_mtime_size(path);

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

pub fn start_stats_watcher(app_handle: AppHandle) -> Result<RecommendedWatcher, String> {
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

    Ok(watcher)
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
