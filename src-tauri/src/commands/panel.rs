use crate::panel::watcher::{sessions_dir, AnalysisStatusEvent, DiffData, FlowData, GitStatus, PanelData, PanelUpdateEvent, ProjectDiff, RepoInfo, SummaryData};
use crate::ClaudeState;
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// Tracks sessions with an analysis in-flight or completed, keyed by session ID
/// with the diff hash as the value. When the diff changes the old entry no longer
/// matches, allowing a new analysis to fire automatically.
static ANALYSIS_ATTEMPTED: std::sync::LazyLock<Mutex<HashMap<String, u64>>> =
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

// --- Input validation ---

fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Session ID cannot be empty".to_string());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Session ID contains invalid characters".to_string());
    }
    // Allow UUID format and simple alphanumeric-hyphen IDs
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Session ID contains invalid characters".to_string());
    }
    Ok(())
}

fn validate_cwd(cwd: &str) -> Result<(), String> {
    if cwd.is_empty() {
        return Err("Working directory cannot be empty".to_string());
    }
    let path = std::path::Path::new(cwd);
    if !path.is_absolute() {
        return Err("Working directory must be an absolute path".to_string());
    }
    if !path.is_dir() {
        return Err(format!("Working directory does not exist: {}", cwd));
    }
    Ok(())
}

fn validate_branch_name(branch: &str) -> Result<(), String> {
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if branch.starts_with('-') {
        return Err("Branch name cannot start with '-'".to_string());
    }
    if branch.contains("..") {
        return Err("Branch name cannot contain '..'".to_string());
    }
    if branch.ends_with(".lock") {
        return Err("Branch name cannot end with '.lock'".to_string());
    }
    let invalid_chars = [' ', '~', '^', ':', '?', '*', '[', '\\', '\x7f'];
    for ch in invalid_chars {
        if branch.contains(ch) {
            return Err(format!("Branch name contains invalid character '{}'", ch));
        }
    }
    if branch.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err("Branch name contains control characters".to_string());
    }
    Ok(())
}

fn validate_file_paths(cwd: &str, files: &[String]) -> Result<(), String> {
    let base = match std::fs::canonicalize(cwd) {
        Ok(p) => p,
        Err(_) => return Err(format!("Cannot resolve working directory: {}", cwd)),
    };
    for file in files {
        if file.is_empty() {
            return Err("File path cannot be empty".to_string());
        }
        if std::path::Path::new(file).is_absolute() {
            return Err(format!("File path must be relative: {}", file));
        }
        // Reject any path containing .. components to prevent traversal
        if file.split('/').any(|c| c == "..") || file.split('\\').any(|c| c == "..") {
            return Err(format!("File path contains '..': {}", file));
        }
        let resolved = base.join(file);
        let normalized = resolved.to_string_lossy();
        let base_str = base.to_string_lossy();
        if !normalized.starts_with(base_str.as_ref()) {
            return Err(format!("File path escapes repository: {}", file));
        }
    }
    Ok(())
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
pub fn refresh_panel(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: String,
) -> Result<Option<PanelData>, String> {
    validate_session_id(&session_id)?;
    validate_cwd(&cwd)?;
    let panel_path = sessions_dir()?.join(&session_id).join("panel.json");

    // Try: is CWD itself inside a git repo?
    let result = if let Ok(git_root) = git_cmd(&cwd, &["rev-parse", "--show-toplevel"]) {
        if !git_root.is_empty() {
            build_panel_single(&session_id, &git_root, &panel_path)?
        } else {
            build_panel_multi(&session_id, &cwd, &panel_path)?
        }
    } else {
        build_panel_multi(&session_id, &cwd, &panel_path)?
    };

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
                let expected_cwd = data.cwd.clone();
                let expected_diff_hash = diff_hash;
                let sid = session_id.clone();
                let path = panel_path.clone();
                let state = claude_state.inner().clone();
                let handle = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    let emit_status = |status: &str, error: Option<String>| {
                        let _ = handle.emit("analysis-status", AnalysisStatusEvent {
                            session_id: sid.clone(),
                            status: status.to_string(),
                            error,
                        });
                    };

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

                    match client.analyze_diff(&raw_diff).await {
                        Ok((summary, flow)) => {
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

    // Preserve existing summary/flow if the diff hasn't changed
    let (prev_summary, prev_flow) = read_existing_analysis(panel_path, &bundle.full);

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
            summary: None,
            flow: None,
        }));
    }

    let combined = all_diffs.join("\n\n");

    // Preserve existing summary/flow if the diff hasn't changed
    let (prev_summary, prev_flow) = read_existing_analysis(panel_path, &combined);

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
        summary: prev_summary,
        flow: prev_flow,
    };

    write_panel(session_id, &data, panel_path);
    Ok(Some(data))
}

struct DiffBundle {
    /// Local working tree changes (Tier 1 only)
    local: String,
    /// Best available diff across all tiers (current behavior)
    full: String,
}

/// Generate synthetic unified diff output for untracked files.
/// Reads each file's contents and produces diff format identical to what
/// `git diff` would show after `git add`.
///
/// Caps individual files at 100 KB and total output at 1 MB to avoid
/// stalling on large untracked assets (images, data files, build artifacts).
fn generate_untracked_diffs(git_root: &str) -> String {
    const MAX_FILE_SIZE: u64 = 100 * 1024;       // 100 KB per file
    const MAX_TOTAL_SIZE: usize = 1024 * 1024;    // 1 MB total output

    let file_list = match git_cmd(git_root, &["ls-files", "--others", "--exclude-standard"]) {
        Ok(list) if !list.is_empty() => list,
        _ => return String::new(),
    };

    let root = std::path::Path::new(git_root);
    let mut result = String::new();

    for rel_path in file_list.lines() {
        let rel_path = rel_path.trim();
        if rel_path.is_empty() {
            continue;
        }

        let abs_path = root.join(rel_path);

        // Skip files that are too large
        if let Ok(meta) = fs::metadata(&abs_path) {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }

        let content = match fs::read(&abs_path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };

        // Skip binary files (null byte in first 8KB)
        let check_len = content.len().min(8192);
        if content[..check_len].contains(&0) {
            continue;
        }

        let text = match String::from_utf8(content) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let lines: Vec<&str> = text.lines().collect();
        let line_count = lines.len().max(1);

        result.push_str(&format!("diff --git a/{path} b/{path}\n", path = rel_path));
        result.push_str("new file mode 100644\n");
        result.push_str("--- /dev/null\n");
        result.push_str(&format!("+++ b/{}\n", rel_path));
        result.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
        for line in &lines {
            result.push('+');
            result.push_str(line);
            result.push('\n');
        }

        if result.len() > MAX_TOTAL_SIZE {
            break;
        }
    }

    result
}

/// 3-tier diff discovery matching sift's extractBestDiff.
/// Returns both local-only changes and the full (best-tier) diff.
fn discover_diff(git_root: &str) -> DiffBundle {
    let untracked = generate_untracked_diffs(git_root);

    // Tier 1: Working tree changes (staged + unstaged vs HEAD)
    let mut local = String::new();
    if let Ok(diff) = git_cmd(git_root, &["diff", "--unified=3", "HEAD"]) {
        if !diff.is_empty() {
            local = diff;
        }
    }
    // Tier 1b: If HEAD doesn't exist (initial commit), try bare git diff
    if local.is_empty() {
        if let Ok(diff) = git_cmd(git_root, &["diff", "--unified=3"]) {
            if !diff.is_empty() {
                local = diff;
            }
        }
    }
    // Tier 1c: Staged-only changes
    if local.is_empty() {
        if let Ok(diff) = git_cmd(git_root, &["diff", "--cached", "--unified=3"]) {
            if !diff.is_empty() {
                local = diff;
            }
        }
    }

    // Append untracked file diffs to local
    if !untracked.is_empty() {
        if !local.is_empty() && !local.ends_with('\n') {
            local.push('\n');
        }
        local.push_str(&untracked);
    }

    // Check for upstream/branch base ref to diff working tree against
    let mut base_ref: Option<String> = None;

    // Tier 2: Upstream tracking branch (use merge-base so we only show
    // local work, not incoming remote changes when upstream is ahead)
    if let Ok(upstream) = git_cmd(
        git_root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    ) {
        if !upstream.is_empty() {
            if let Ok(mb) = git_cmd(git_root, &["merge-base", &upstream, "HEAD"]) {
                if !mb.is_empty() {
                    base_ref = Some(mb);
                }
            }
        }
    }

    // Tier 3: Merge-base with main/master (only if Tier 2 found nothing)
    if base_ref.is_none() {
        let base_branch = if git_cmd(git_root, &["rev-parse", "--verify", "main"]).is_ok() {
            Some("main")
        } else if git_cmd(git_root, &["rev-parse", "--verify", "master"]).is_ok() {
            Some("master")
        } else {
            None
        };

        if let Some(base) = base_branch {
            if let Ok(merge_base) = git_cmd(git_root, &["merge-base", base, "HEAD"]) {
                if !merge_base.is_empty() {
                    base_ref = Some(merge_base);
                }
            }
        }
    }

    // Build `full` diff: working tree vs upstream/base (includes both local and committed changes)
    let mut full = if let Some(ref base) = base_ref {
        // Diff working tree (including uncommitted changes) against the base ref
        git_cmd(git_root, &["diff", "--unified=3", base])
            .ok()
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| local.clone())
    } else {
        local.clone()
    };

    // Append untracked file diffs to full (if full came from base-ref diff, it won't have them)
    if base_ref.is_some() && !untracked.is_empty() {
        if !full.is_empty() && !full.ends_with('\n') {
            full.push('\n');
        }
        full.push_str(&untracked);
    }

    DiffBundle { local, full }
}

fn count_diff_stats(raw: &str) -> (u32, u32, u32) {
    let files = raw.matches("\ndiff --git ").count() as u32
        + if raw.starts_with("diff --git ") { 1 } else { 0 };
    let added = raw
        .lines()
        .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
        .count() as u32;
    let removed = raw
        .lines()
        .filter(|l| l.starts_with('-') && !l.starts_with("---"))
        .count() as u32;
    (files, added, removed)
}

/// Read the existing panel.json and return its summary/flow if the diff matches.
/// This prevents polling from clobbering async Claude analysis results.
fn read_existing_analysis(
    panel_path: &std::path::Path,
    current_diff_raw: &str,
) -> (Option<SummaryData>, Option<FlowData>) {
    if let Ok(contents) = fs::read_to_string(panel_path) {
        if let Ok(existing) = serde_json::from_str::<PanelData>(&contents) {
            if let Some(ref diff) = existing.diff {
                if diff.raw == current_diff_raw {
                    return (existing.summary, existing.flow);
                }
            }
        }
    }
    (None, None)
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
#[tauri::command]
pub fn reset_analysis(session_id: String) -> Result<(), String> {
    validate_session_id(&session_id)?;
    if let Ok(mut map) = ANALYSIS_ATTEMPTED.lock() {
        map.remove(&session_id);
    }
    Ok(())
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
    // Clear all attempted flags so analysis retries with the new key
    if let Ok(mut map) = ANALYSIS_ATTEMPTED.lock() {
        map.clear();
    }
    Ok(())
}

/// Check whether an API key is configured
#[tauri::command]
pub fn get_api_status(app_handle: tauri::AppHandle) -> bool {
    let state: tauri::State<ClaudeState> = app_handle.state();
    state.read().map(|g| g.is_some()).unwrap_or(false)
}

/// Stage all changes in the given git repo.
#[tauri::command(async)]
pub async fn git_stage_all(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["add", "-A"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Stage specific files in the given git repo.
#[tauri::command(async)]
pub async fn git_stage_files(cwd: String, files: Vec<String>) -> Result<(), String> {
    validate_cwd(&cwd)?;
    if files.is_empty() {
        return Ok(());
    }
    validate_file_paths(&cwd, &files)?;
    tokio::task::spawn_blocking(move || {
        let mut args = vec!["add", "-A", "--"];
        let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        git_cmd(&cwd, &args).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Discard all working tree changes (unstaged + staged) in the given git repo.
#[tauri::command(async)]
pub async fn git_discard_all(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let _ = git_cmd(&cwd, &["reset", "HEAD", "--"]);
        git_cmd(&cwd, &["checkout", "--", "."])?;
        git_cmd(&cwd, &["clean", "-fd"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Get the current git status for determining the adaptive button state.
#[tauri::command(async)]
pub async fn get_git_status(cwd: String) -> Result<GitStatus, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        // Verify this is actually a git repository
        git_cmd(&cwd, &["rev-parse", "--git-dir"])?;

        // Check for unstaged changes (working tree vs index)
        // git diff --quiet exits 1 when there are changes
        let has_modified = git_cmd(&cwd, &["diff", "--quiet"]).is_err();

        // Check for untracked files
        let has_untracked = git_cmd(&cwd, &["ls-files", "--others", "--exclude-standard"])
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        let has_unstaged = has_modified || has_untracked;

        // Check for staged changes (index vs HEAD)
        let has_staged = git_cmd(&cwd, &["diff", "--cached", "--quiet"]).is_err();

        // Check for unpushed commits
        let has_unpushed = git_cmd(&cwd, &["rev-list", "@{u}..HEAD", "--count"])
            .map(|s| s.trim().parse::<u32>().unwrap_or(0) > 0)
            .unwrap_or(false);

        // Check for commits behind upstream
        let commits_behind = git_cmd(&cwd, &["rev-list", "HEAD..@{u}", "--count"])
            .map(|s| s.trim().parse::<u32>().unwrap_or(0))
            .unwrap_or(0);

        // Get current branch
        let branch = git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
            .unwrap_or_default();

        Ok(GitStatus {
            has_unstaged,
            has_staged,
            has_unpushed,
            commits_behind,
            branch,
        })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Commit all changes with the given message. Stages everything first.
#[tauri::command(async)]
pub async fn git_commit(cwd: String, message: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    if message.contains('\0') {
        return Err("Commit message contains invalid characters".to_string());
    }
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["add", "-A"])?;
        git_cmd(&cwd, &["commit", "-m", &message])?;
        Ok(())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Push to the upstream remote.
#[tauri::command(async)]
pub async fn git_push(cwd: String) -> Result<String, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let has_upstream = git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok();

        if has_upstream {
            git_cmd(&cwd, &["push"])?;
            return Ok("Pushed to remote".to_string());
        }

        let has_origin = git_cmd(&cwd, &["remote", "get-url", "origin"]).is_ok();
        if !has_origin {
            return Err("No remote 'origin' configured. Add a remote first.".to_string());
        }

        let branch = git_cmd(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        git_cmd(&cwd, &["push", "-u", "origin", &branch])?;
        Ok("Pushed and set upstream".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Fetch from remote with prune.
#[tauri::command(async)]
pub async fn git_fetch(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["fetch", "--prune"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Pull from remote.
#[tauri::command(async)]
pub async fn git_pull(cwd: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["pull"]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// List child git repos with their current branch names.
#[tauri::command(async)]
pub async fn get_child_repos(cwd: String) -> Result<Vec<RepoInfo>, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let mut entries: Vec<_> = match fs::read_dir(&cwd) {
            Ok(e) => e.flatten().collect(),
            Err(_) => return Ok(Vec::new()),
        };
        entries.sort_by_key(|e| e.file_name());

        let mut repos = Vec::new();
        for entry in entries {
            if !entry.file_type().map_or(false, |t| t.is_dir()) {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();
            let child = entry.path().to_string_lossy().to_string();
            if should_skip_dir(&name_str) {
                continue;
            }
            if git_cmd(&child, &["rev-parse", "--show-toplevel"]).is_err() {
                continue;
            }
            let branch = git_cmd(&child, &["rev-parse", "--abbrev-ref", "HEAD"])
                .unwrap_or_default();
            let commits_behind = git_cmd(&child, &["rev-list", "HEAD..@{u}", "--count"])
                .map(|s| s.trim().parse::<u32>().unwrap_or(0))
                .unwrap_or(0);
            repos.push(RepoInfo { name: name_str, branch, commits_behind });
        }
        Ok(repos)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Check whether a directory should be skipped during repo scanning.
/// `name` is the directory basename, `abs_path` is the full absolute path.
/// Excluded entries can be simple names (e.g. "vendor") or absolute paths
/// (e.g. "/Users/jake/repos/legacy") from the folder browser.
/// List local branches with the current branch marked.
#[tauri::command(async)]
pub async fn git_list_branches(cwd: String) -> Result<Vec<crate::panel::watcher::BranchInfo>, String> {
    validate_cwd(&cwd)?;
    tokio::task::spawn_blocking(move || {
        let output = git_cmd(&cwd, &["branch", "--format=%(refname:short)\t%(HEAD)"])?;
        let mut branches: Vec<crate::panel::watcher::BranchInfo> = output
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                if parts.len() == 2 {
                    Some(crate::panel::watcher::BranchInfo {
                        name: parts[0].trim().to_string(),
                        is_current: parts[1].trim() == "*",
                    })
                } else {
                    None
                }
            })
            .collect();

        let local_names: std::collections::HashSet<String> =
            branches.iter().map(|b| b.name.clone()).collect();
        for default_branch in &["main", "master"] {
            if !local_names.contains(*default_branch) {
                let remote_ref = format!("origin/{}", default_branch);
                if git_cmd(&cwd, &["rev-parse", "--verify", &format!("refs/remotes/{}", remote_ref)])
                    .is_ok()
                {
                    branches.push(crate::panel::watcher::BranchInfo {
                        name: default_branch.to_string(),
                        is_current: false,
                    });
                }
            }
        }

        Ok(branches)
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Checkout an existing local branch.
#[tauri::command(async)]
pub async fn git_checkout_branch(cwd: String, branch: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    validate_branch_name(&branch)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["checkout", &branch]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

/// Create and switch to a new branch via `git checkout -b`.
#[tauri::command(async)]
pub async fn git_create_branch(cwd: String, branch: String) -> Result<(), String> {
    validate_cwd(&cwd)?;
    validate_branch_name(&branch)?;
    tokio::task::spawn_blocking(move || {
        git_cmd(&cwd, &["checkout", "-b", &branch]).map(|_| ())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
}

fn git_cmd(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args([&["-C", cwd], args].concat())
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Manual UTC formatting to avoid pulling in chrono for one function
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Days since epoch to Y-M-D (civil calendar)
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for (i, days_in_month) in month_days.iter().enumerate() {
        if remaining < *days_in_month as i64 {
            break;
        }
        remaining -= *days_in_month as i64;
        m = i + 1;
    }
    // Clamp to valid month range (0..=11) to prevent overflow from edge cases
    if m > 11 {
        m = 11;
        remaining = 0;
    }

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m + 1, remaining + 1, hours, minutes, seconds
    )
}

/// Convert a Unix timestamp (seconds since epoch) to ISO 8601 string.
/// Extracted for testability.
#[cfg(test)]
fn unix_to_iso8601(secs: u64) -> String {
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for (i, days_in_month) in month_days.iter().enumerate() {
        if remaining < *days_in_month as i64 {
            break;
        }
        remaining -= *days_in_month as i64;
        m = i + 1;
    }
    if m > 11 {
        m = 11;
        remaining = 0;
    }

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m + 1, remaining + 1, hours, minutes, seconds
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_diff_stats_single_file() {
        let diff = "\
diff --git a/file.rs b/file.rs
--- a/file.rs
+++ b/file.rs
@@ -1,3 +1,4 @@
 unchanged
+added line
-removed line
 unchanged";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 1);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn count_diff_stats_multiple_files() {
        let diff = "\
diff --git a/a.rs b/a.rs
--- a/a.rs
+++ b/a.rs
@@ -1,2 +1,3 @@
 unchanged
+added1
+added2

diff --git a/b.rs b/b.rs
--- a/b.rs
+++ b/b.rs
@@ -1,3 +1,2 @@
 unchanged
-removed1
-removed2";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 2);
        assert_eq!(added, 2);
        assert_eq!(removed, 2);
    }

    #[test]
    fn count_diff_stats_empty() {
        let (files, added, removed) = count_diff_stats("");
        assert_eq!(files, 0);
        assert_eq!(added, 0);
        assert_eq!(removed, 0);
    }

    #[test]
    fn count_diff_stats_excludes_file_markers() {
        // Lines starting with +++ or --- are file markers, not content changes
        let diff = "\
diff --git a/file.rs b/file.rs
--- a/file.rs
+++ b/file.rs
@@ -1 +1 @@
-old
+new";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 1);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

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
        assert!(parsed.summary.is_none());
        assert!(parsed.flow.is_none());
    }

    // --- unix_to_iso8601 boundary tests ---

    #[test]
    fn iso8601_epoch() {
        assert_eq!(unix_to_iso8601(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn iso8601_jan1_2024() {
        // 2024-01-01 00:00:00 UTC = 1704067200
        assert_eq!(unix_to_iso8601(1704067200), "2024-01-01T00:00:00Z");
    }

    #[test]
    fn iso8601_leap_year_feb29() {
        // 2024-02-29 12:00:00 UTC = 1709208000
        assert_eq!(unix_to_iso8601(1709208000), "2024-02-29T12:00:00Z");
    }

    #[test]
    fn iso8601_dec31_end_of_year() {
        // 2024-12-31 23:59:59 UTC = 1735689599
        assert_eq!(unix_to_iso8601(1735689599), "2024-12-31T23:59:59Z");
    }

    #[test]
    fn iso8601_non_leap_year_mar1() {
        // 2023-03-01 00:00:00 UTC = 1677628800
        assert_eq!(unix_to_iso8601(1677628800), "2023-03-01T00:00:00Z");
    }

    #[test]
    fn iso8601_month_never_exceeds_12() {
        // Test a wide range of timestamps to ensure month is always 1-12
        for secs in (0..2_000_000_000u64).step_by(86400 * 37) {
            let ts = unix_to_iso8601(secs);
            let parts: Vec<&str> = ts.split('T').collect();
            let date_parts: Vec<&str> = parts[0].split('-').collect();
            let month: u32 = date_parts[1].parse().unwrap();
            let day: u32 = date_parts[2].parse().unwrap();
            assert!(month >= 1 && month <= 12, "Invalid month {} in {}", month, ts);
            assert!(day >= 1 && day <= 31, "Invalid day {} in {}", day, ts);
        }
    }

    // --- should_skip_dir tests ---

    #[test]
    fn skip_hidden_dirs() {
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir(".hidden"));
    }

    #[test]
    fn skip_node_modules_and_target() {
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir("target"));
    }

    #[test]
    fn allow_normal_dirs() {
        assert!(!should_skip_dir("src"));
        assert!(!should_skip_dir("my-project"));
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

    // --- git_cmd error handling ---

    #[test]
    fn git_cmd_nonexistent_dir() {
        let result = git_cmd("/nonexistent/path/that/should/not/exist", &["status"]);
        assert!(result.is_err());
    }

    // --- generate_untracked_diffs on non-git dir ---

    #[test]
    fn untracked_diffs_non_git_dir() {
        let result = generate_untracked_diffs("/tmp");
        assert!(result.is_empty());
    }

    // --- Input validation tests ---

    #[test]
    fn validate_session_id_accepts_valid_uuid() {
        assert!(validate_session_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn validate_session_id_accepts_simple_id() {
        assert!(validate_session_id("my-session-123").is_ok());
    }

    #[test]
    fn validate_session_id_rejects_empty() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn validate_session_id_rejects_path_traversal() {
        assert!(validate_session_id("../../etc/passwd").is_err());
    }

    #[test]
    fn validate_session_id_rejects_slashes() {
        assert!(validate_session_id("abc/def").is_err());
        assert!(validate_session_id("abc\\def").is_err());
    }

    #[test]
    fn validate_session_id_rejects_special_chars() {
        assert!(validate_session_id("abc def").is_err());
        assert!(validate_session_id("abc!def").is_err());
    }

    #[test]
    fn validate_cwd_rejects_empty() {
        assert!(validate_cwd("").is_err());
    }

    #[test]
    fn validate_cwd_rejects_relative_path() {
        assert!(validate_cwd("relative/path").is_err());
    }

    #[test]
    fn validate_cwd_rejects_nonexistent_path() {
        assert!(validate_cwd("/nonexistent/path/should/not/exist").is_err());
    }

    #[test]
    fn validate_cwd_accepts_existing_dir() {
        assert!(validate_cwd("/tmp").is_ok());
    }

    #[test]
    fn validate_branch_name_accepts_valid() {
        assert!(validate_branch_name("feature/my-branch").is_ok());
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("fix-123").is_ok());
        assert!(validate_branch_name("release/v1.0").is_ok());
    }

    #[test]
    fn validate_branch_name_rejects_empty() {
        assert!(validate_branch_name("").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_double_dot() {
        assert!(validate_branch_name("branch..name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_leading_dash() {
        assert!(validate_branch_name("-bad-name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_space() {
        assert!(validate_branch_name("bad name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_tilde() {
        assert!(validate_branch_name("bad~name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_lock_suffix() {
        assert!(validate_branch_name("refs/heads/main.lock").is_err());
    }

    #[test]
    fn validate_file_paths_rejects_absolute_path() {
        assert!(validate_file_paths("/tmp", &["/etc/passwd".to_string()]).is_err());
    }

    #[test]
    fn validate_file_paths_rejects_traversal() {
        assert!(validate_file_paths("/tmp", &["../../etc/passwd".to_string()]).is_err());
    }

    #[test]
    fn validate_file_paths_accepts_relative() {
        assert!(validate_file_paths("/tmp", &["subdir/file.txt".to_string()]).is_ok());
    }

    #[test]
    fn validate_file_paths_rejects_empty() {
        assert!(validate_file_paths("/tmp", &["".to_string()]).is_err());
    }

    // --- Additional count_diff_stats edge cases ---

    #[test]
    fn count_diff_stats_metadata_only_lines() {
        let diff = "--- a/file\n+++ b/file";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 0);
        assert_eq!(added, 0);
        assert_eq!(removed, 0);
    }

    #[test]
    fn count_diff_stats_no_diff_header() {
        let diff = "+added line\n-removed line";
        let (files, added, removed) = count_diff_stats(diff);
        assert_eq!(files, 0);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn validate_branch_name_rejects_del_character() {
        assert!(validate_branch_name("bad\x7fname").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_control_chars() {
        assert!(validate_branch_name("bad\x01name").is_err());
        assert!(validate_branch_name("bad\tname").is_err());
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
