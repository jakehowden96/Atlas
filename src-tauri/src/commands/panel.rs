use crate::analysis;
use crate::panel::types::{
    sessions_dir, AnalysisStatusEvent, DiffData, FlowData, PanelData, PanelUpdateEvent,
    ProjectDiff, SummaryData,
};
use crate::ClaudeState;
use super::diff::{count_diff_stats, discover_diff};
use super::git::{git_cmd, should_skip_dir};
use super::validate::{validate_cwd, validate_session_id};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

/// Tracks sessions with an analysis in-flight or completed, keyed by session ID
/// with the diff hash as the value. When the diff changes the old entry no longer
/// matches, allowing a new analysis to fire automatically.
static ANALYSIS_ATTEMPTED: std::sync::LazyLock<Mutex<HashMap<String, u64>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Cancellation tokens for in-flight analysis tasks, keyed by session ID.
/// When a new analysis is spawned, any existing token for that session is
/// cancelled first, preventing stale results from overwriting fresher data.
static ANALYSIS_TOKENS: std::sync::LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Per-session mutex to serialize panel.json read-modify-write operations.
static PANEL_LOCKS: std::sync::LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn panel_lock(session_id: &str) -> Arc<Mutex<()>> {
    let mut map = PANEL_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(session_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn hash_diff(raw: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    raw.hash(&mut hasher);
    hasher.finish()
}

#[tauri::command]
pub fn get_session_dir(session_id: String) -> Result<String, String> {
    validate_session_id(&session_id)?;
    let dir = sessions_dir()?.join(&session_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}

#[tauri::command(async)]
pub fn get_panel_data(session_id: String) -> Result<Option<PanelData>, String> {
    validate_session_id(&session_id)?;
    let path = sessions_dir()?.join(&session_id).join("panel.json");
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: PanelData = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(Some(data))
}

/// Run diff discovery for a CWD. Supports both single-repo and multi-repo layouts.
///
/// If CWD is inside a git repo → discover diff for that repo.
/// If CWD is NOT a git repo → scan child directories for git repos,
/// collect diffs from all repos with changes (like sift's scanForRepos).
#[tauri::command(async)]
pub async fn refresh_panel(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: String,
) -> Result<Option<PanelData>, String> {
    validate_session_id(&session_id)?;
    validate_cwd(&cwd)?;
    let panel_path = sessions_dir()?.join(&session_id).join("panel.json");

    // Run blocking git operations on a dedicated thread to avoid starving
    // the async runtime.
    let sid_clone = session_id.clone();
    let cwd_clone = cwd.clone();
    let path_clone = panel_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        // Try: is CWD itself inside a git repo?
        if let Ok(git_root) = git_cmd(&cwd_clone, &["rev-parse", "--show-toplevel"]) {
            if !git_root.is_empty() {
                build_panel_single(&sid_clone, &git_root, &path_clone)
            } else {
                build_panel_multi(&sid_clone, &cwd_clone, &path_clone)
            }
        } else {
            build_panel_multi(&sid_clone, &cwd_clone, &path_clone)
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Spawn async Claude analysis if we have a diff, an API key, and no existing analysis
    if let Some(ref data) = result {
        if let Some(ref diff) = data.diff {
            let already_analyzed = data.summary.is_some();
            let diff_hash = hash_diff(&diff.raw);
            // Atomic check-and-insert: single lock acquisition prevents duplicate spawns
            let should_analyze = if let Ok(mut map) = ANALYSIS_ATTEMPTED.lock() {
                if already_analyzed {
                    false
                } else if map.get(&session_id) == Some(&diff_hash) {
                    false // already attempted for this exact diff
                } else {
                    map.insert(session_id.clone(), diff_hash);
                    true
                }
            } else {
                false
            };
            let claude_state: tauri::State<ClaudeState> = app_handle.state();
            let has_client = claude_state.read().map(|g| g.is_some()).unwrap_or(false);
            if has_client && should_analyze {
                let raw_diff = diff.raw.clone();
                let plan_text = data.plan.clone();
                let expected_cwd = data.cwd.clone();
                let expected_diff_hash = diff_hash;
                let sid = session_id.clone();
                let path = panel_path.clone();
                let state = claude_state.inner().clone();
                let handle = app_handle.clone();

                // Cancel any in-flight analysis for this session before spawning a new one
                let token = CancellationToken::new();
                if let Ok(mut tokens) = ANALYSIS_TOKENS.lock() {
                    if let Some(old_token) = tokens.insert(sid.clone(), token.clone()) {
                        old_token.cancel();
                    }
                }

                tauri::async_runtime::spawn(async move {
                    let emit_status = |status: &str, error: Option<String>| {
                        let _ = handle.emit("analysis-status", AnalysisStatusEvent {
                            session_id: sid.clone(),
                            status: status.to_string(),
                            error,
                        });
                    };

                    // Check for cancellation before starting
                    if token.is_cancelled() {
                        log::info!("Analysis for session {} cancelled before start", sid);
                        return;
                    }

                    let client = {
                        let guard = match state.read() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        match guard.as_ref() {
                            Some(c) => c.clone(),
                            None => return,
                        }
                    };

                    emit_status("running", None);

                    // Run static analysis to extract code context
                    let analysis_ctx = analysis::analyze_changed_files(&expected_cwd, &raw_diff);
                    let context_str = analysis::format_context(&analysis_ctx);

                    match client.analyze_diff(&raw_diff, &context_str, plan_text.as_deref()).await {
                        Ok((summary, flow)) => {
                            // Check for cancellation after the API call completes
                            if token.is_cancelled() {
                                log::info!("Analysis for session {} cancelled after API call", sid);
                                return;
                            }

                            // Acquire panel lock for atomic read-check-write
                            let lock = panel_lock(&sid);
                            let emit_panel = {
                                let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

                                let mut result = None;
                                if let Ok(contents) = fs::read_to_string(&path) {
                                    if let Ok(mut panel) =
                                        serde_json::from_str::<PanelData>(&contents)
                                    {
                                        let current_diff_hash = panel.diff.as_ref()
                                            .map(|d| hash_diff(&d.raw))
                                            .unwrap_or(0);
                                        if panel.cwd == expected_cwd && current_diff_hash == expected_diff_hash {
                                            panel.summary = Some(summary);
                                            panel.flow = Some(flow);
                                            if let Ok(dir) = sessions_dir() {
                                                let dir = dir.join(&sid);
                                                let _ = fs::create_dir_all(&dir);
                                                if let Ok(json) = serde_json::to_string_pretty(&panel) {
                                                    let _ = fs::write(&path, json);
                                                }
                                            }
                                            result = Some(panel);
                                        }
                                    }
                                }
                                result
                            }; // _guard dropped here — lock released before emit

                            if let Some(panel) = emit_panel {
                                let _ = handle.emit("panel-update", PanelUpdateEvent {
                                    session_id: sid.clone(),
                                    data: panel,
                                });
                                emit_status("complete", None);
                            }
                        }
                        Err(e) => {
                            log::error!("Claude analysis failed: {}", e);
                            emit_status("error", Some(e));
                        }
                    }
                });
            }
        }
    }

    Ok(result)
}

/// Single repo: discover diff and build PanelData
fn build_panel_single(
    session_id: &str,
    git_root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, String> {
    let bundle = discover_diff(git_root);

    if bundle.full.is_empty() {
        let _ = fs::remove_file(panel_path);
        return Ok(Some(PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: git_root.to_string(),
            is_git: true,
            diff: None,
            plan: None,
            summary: None,
            flow: None,
        }));
    }

    let (files_changed, lines_added, lines_removed) = count_diff_stats(&bundle.full);

    // Only populate local_* fields when local differs from full (i.e. full includes upstream/branch changes)
    let (local_raw, local_fc, local_la, local_lr) = if !bundle.local.is_empty() && bundle.local != bundle.full {
        let (fc, la, lr) = count_diff_stats(&bundle.local);
        (Some(bundle.local), Some(fc), Some(la), Some(lr))
    } else {
        (None, None, None, None)
    };

    // Preserve existing summary/flow/plan if the diff hasn't changed
    let (prev_summary, prev_flow, prev_plan) = read_existing_analysis(panel_path, &bundle.full);

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: git_root.to_string(),
        is_git: true,
        diff: Some(DiffData {
            raw: bundle.full,
            files_changed,
            lines_added,
            lines_removed,
            projects: None,
            local_raw,
            local_files_changed: local_fc,
            local_lines_added: local_la,
            local_lines_removed: local_lr,
        }),
        plan: prev_plan,
        summary: prev_summary,
        flow: prev_flow,
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// Multi-repo: scan child dirs for git repos, aggregate diffs from all that have changes
fn build_panel_multi(
    session_id: &str,
    root: &str,
    panel_path: &std::path::Path,
) -> Result<Option<PanelData>, String> {
    let mut dir_entries: Vec<_> = match fs::read_dir(root) {
        Ok(e) => e.flatten().collect(),
        Err(_) => return Ok(None),
    };
    // Sort for deterministic ordering — fs::read_dir order is platform-dependent
    dir_entries.sort_by_key(|e| e.file_name());

    let mut all_diffs = Vec::new();
    let mut projects = Vec::new();
    let mut total_files: u32 = 0;
    let mut total_added: u32 = 0;
    let mut total_removed: u32 = 0;
    let mut found_any_repo = false;

    for entry in dir_entries {
        if !entry.file_type().map_or(false, |t| t.is_dir()) {
            continue;
        }

        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let child_path = entry.path();
        let child_str = child_path.to_string_lossy().to_string();
        if should_skip_dir(&name_str) {
            continue;
        }

        // Check if this child is a git repo
        if git_cmd(&child_str, &["rev-parse", "--show-toplevel"]).is_err() {
            continue;
        }

        found_any_repo = true;

        let bundle = discover_diff(&child_str);
        if bundle.full.is_empty() {
            continue;
        }

        let (fc, la, lr) = count_diff_stats(&bundle.full);
        total_files += fc;
        total_added += la;
        total_removed += lr;

        projects.push(ProjectDiff {
            name: name_str.to_string(),
            raw: bundle.full.clone(),
            files_changed: fc,
            lines_added: la,
            lines_removed: lr,
        });

        all_diffs.push(bundle.full);
    }

    if all_diffs.is_empty() {
        let _ = fs::remove_file(panel_path);
        if !found_any_repo {
            return Ok(None);
        }
        return Ok(Some(PanelData {
            version: 1,
            timestamp: now_iso8601(),
            cwd: root.to_string(),
            is_git: true,
            diff: None,
            plan: None,
            summary: None,
            flow: None,
        }));
    }

    let combined = all_diffs.join("\n\n");

    // Preserve existing summary/flow/plan if the diff hasn't changed
    let (prev_summary, prev_flow, prev_plan) = read_existing_analysis(panel_path, &combined);

    let data = PanelData {
        version: 1,
        timestamp: now_iso8601(),
        cwd: root.to_string(),
        is_git: true,
        diff: Some(DiffData {
            raw: combined,
            files_changed: total_files,
            lines_added: total_added,
            lines_removed: total_removed,
            projects: Some(projects),
            local_raw: None,
            local_files_changed: None,
            local_lines_added: None,
            local_lines_removed: None,
        }),
        plan: prev_plan,
        summary: prev_summary,
        flow: prev_flow,
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

/// Read the existing panel.json and return its summary/flow/plan if the diff matches.
/// This prevents polling from clobbering async Claude analysis results.
fn read_existing_analysis(
    panel_path: &std::path::Path,
    current_diff_raw: &str,
) -> (Option<SummaryData>, Option<FlowData>, Option<String>) {
    if let Ok(contents) = fs::read_to_string(panel_path) {
        if let Ok(existing) = serde_json::from_str::<PanelData>(&contents) {
            if let Some(ref diff) = existing.diff {
                if diff.raw == current_diff_raw {
                    return (existing.summary, existing.flow, existing.plan);
                }
            }
        }
    }
    (None, None, None)
}

fn write_panel(session_id: &str, data: &PanelData, panel_path: &std::path::Path) {
    let lock = panel_lock(session_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let dir = match sessions_dir() {
        Ok(d) => d.join(session_id),
        Err(e) => { log::warn!("Failed to resolve sessions dir: {}", e); return; }
    };
    if let Err(e) = fs::create_dir_all(&dir) {
        log::warn!("Failed to create session dir: {}", e);
        return;
    }
    match serde_json::to_string_pretty(data) {
        Ok(json) => {
            if let Err(e) = fs::write(panel_path, json) {
                log::warn!("Failed to write panel.json: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize panel data: {}", e),
    }
}

/// Clear the analysis-attempted flag so the next refresh retries the API call.
/// Also cancels any in-flight analysis for the session.
#[tauri::command]
pub fn reset_analysis(session_id: String) -> Result<(), String> {
    validate_session_id(&session_id)?;
    cleanup_session_analysis(&session_id);
    Ok(())
}

/// Clean up analysis state for a destroyed session. Call when a PTY session
/// is terminated to free memory held by the static maps.
pub fn cleanup_session_analysis(session_id: &str) {
    if let Ok(mut map) = ANALYSIS_ATTEMPTED.lock() {
        map.remove(session_id);
    }
    if let Ok(mut tokens) = ANALYSIS_TOKENS.lock() {
        if let Some(token) = tokens.remove(session_id) {
            token.cancel();
        }
    }
    if let Ok(mut map) = PANEL_LOCKS.lock() {
        map.remove(session_id);
    }
}

/// Set the API key at runtime and persist to ~/.atlas/config.json
#[tauri::command]
pub fn set_api_key(
    app_handle: tauri::AppHandle,
    api_key: String,
) -> Result<(), String> {
    crate::write_config_api_key(&api_key)?;
    let client = crate::build_claude_client(api_key)?;
    let state: tauri::State<ClaudeState> = app_handle.state();
    let mut guard = state.write().map_err(|e| format!("Lock poisoned: {}", e))?;
    *guard = Some(client);
    drop(guard);
    // Clear all attempted flags and cancel in-flight analyses so analysis retries with the new key
    if let Ok(mut map) = ANALYSIS_ATTEMPTED.lock() {
        map.clear();
    }
    if let Ok(mut tokens) = ANALYSIS_TOKENS.lock() {
        for (_, token) in tokens.drain() {
            token.cancel();
        }
    }
    Ok(())
}

/// Check whether an API key is configured
#[tauri::command]
pub fn get_api_status(app_handle: tauri::AppHandle) -> bool {
    let state: tauri::State<ClaudeState> = app_handle.state();
    state.read().map(|g| g.is_some()).unwrap_or(false)
}

fn now_iso8601() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::panel::types::{Concern, SummaryData};

    #[test]
    fn now_iso8601_format() {
        let ts = now_iso8601();
        // Should match ISO 8601 UTC format
        assert!(
            ts.len() == 20,
            "Expected 20-char timestamp, got: {}",
            ts
        );
        assert!(ts.ends_with('Z'), "Expected Z suffix, got: {}", ts);
        assert!(ts.contains('T'), "Expected T separator, got: {}", ts);
        // Should parse as valid date components
        let parts: Vec<&str> = ts.split('T').collect();
        assert_eq!(parts.len(), 2);
        let date_parts: Vec<&str> = parts[0].split('-').collect();
        assert_eq!(date_parts.len(), 3);
        let year: i32 = date_parts[0].parse().unwrap();
        assert!(year >= 2024);
    }

    #[test]
    fn panel_data_serialization_roundtrip() {
        let data = PanelData {
            version: 1,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            cwd: "/tmp/test".to_string(),
            is_git: true,
            diff: Some(DiffData {
                raw: "diff --git a/f b/f\n+added".to_string(),
                files_changed: 1,
                lines_added: 1,
                lines_removed: 0,
                projects: None,
                local_raw: None,
                local_files_changed: None,
                local_lines_added: None,
                local_lines_removed: None,
            }),
            plan: None,
            summary: None,
            flow: None,
        };

        let json = serde_json::to_string(&data).unwrap();
        let parsed: PanelData = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.cwd, "/tmp/test");
        assert!(parsed.diff.is_some());
        let diff = parsed.diff.unwrap();
        assert_eq!(diff.files_changed, 1);
        assert_eq!(diff.lines_added, 1);
        assert_eq!(diff.lines_removed, 0);
        assert!(parsed.plan.is_none());
        assert!(parsed.summary.is_none());
        assert!(parsed.flow.is_none());
    }

    #[test]
    fn panel_data_with_plan_roundtrip() {
        let data = PanelData {
            version: 1,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            cwd: "/tmp/test".to_string(),
            is_git: true,
            diff: None,
            plan: Some("## Plan\nRefactor the auth module".to_string()),
            summary: None,
            flow: None,
        };

        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"plan\""));
        let parsed: PanelData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.plan.as_deref(), Some("## Plan\nRefactor the auth module"));
    }

    #[test]
    fn panel_data_plan_omitted_when_none() {
        let data = PanelData {
            version: 1,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            cwd: "/tmp/test".to_string(),
            is_git: true,
            diff: None,
            plan: None,
            summary: None,
            flow: None,
        };

        let json = serde_json::to_string(&data).unwrap();
        assert!(!json.contains("\"plan\""), "plan field should be omitted when None");
    }

    #[test]
    fn panel_data_deserializes_without_plan_field() {
        // Simulates old panel.json files that lack the plan field
        let json = r#"{
            "version": 1,
            "timestamp": "2024-01-01T00:00:00Z",
            "cwd": "/tmp/test",
            "is_git": true
        }"#;
        let parsed: PanelData = serde_json::from_str(json).unwrap();
        assert!(parsed.plan.is_none());
    }

    #[test]
    fn summary_data_serialization_roundtrip() {
        let summary = SummaryData {
            intent: "Fix login timeout on slow networks".to_string(),
            approach: "Increased timeout from 5s to 30s with exponential backoff".to_string(),
            impact: "Affects auth.rs and the login API handler".to_string(),
            concerns: vec![
                Concern {
                    severity: "warning".to_string(),
                    description: "30s timeout may be too generous for DoS scenarios".to_string(),
                    file: Some("src/auth.rs".to_string()),
                    line: Some(42),
                },
                Concern {
                    severity: "info".to_string(),
                    description: "Consider making timeout configurable".to_string(),
                    file: None,
                    line: None,
                },
            ],
            truncated: false,
        };

        let json = serde_json::to_string(&summary).unwrap();
        let parsed: SummaryData = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.intent, summary.intent);
        assert_eq!(parsed.approach, summary.approach);
        assert_eq!(parsed.impact, summary.impact);
        assert_eq!(parsed.concerns.len(), 2);
        assert_eq!(parsed.concerns[0].severity, "warning");
        assert_eq!(parsed.concerns[0].file.as_deref(), Some("src/auth.rs"));
        assert_eq!(parsed.concerns[0].line, Some(42));
        assert_eq!(parsed.concerns[1].file, None);
        assert_eq!(parsed.concerns[1].line, None);
    }

    #[test]
    fn summary_data_deserializes_with_empty_concerns() {
        let json = r#"{
            "intent": "test",
            "approach": "test",
            "impact": "test"
        }"#;
        let parsed: SummaryData = serde_json::from_str(json).unwrap();
        assert!(parsed.concerns.is_empty());
    }

    #[test]
    fn concern_omits_null_fields() {
        let concern = Concern {
            severity: "info".to_string(),
            description: "Test concern".to_string(),
            file: None,
            line: None,
        };

        let json = serde_json::to_string(&concern).unwrap();
        assert!(!json.contains("\"file\""), "file should be omitted when None");
        assert!(!json.contains("\"line\""), "line should be omitted when None");
    }

    // --- hash_diff tests ---

    #[test]
    fn hash_diff_deterministic() {
        let diff = "some diff content";
        assert_eq!(hash_diff(diff), hash_diff(diff));
    }

    #[test]
    fn hash_diff_different_inputs() {
        assert_ne!(hash_diff("diff a"), hash_diff("diff b"));
    }

    // --- sessions_dir tests ---

    #[test]
    fn sessions_dir_returns_valid_path() {
        let dir = sessions_dir();
        assert!(dir.is_ok());
        let path = dir.unwrap();
        assert!(path.to_string_lossy().contains(".atlas"));
        assert!(path.to_string_lossy().contains("sessions"));
    }
}
