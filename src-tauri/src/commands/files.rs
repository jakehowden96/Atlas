//! Files screen backend: the workspace document tree, `~/.claude/plans`,
//! reading and writing documents, and watching for external edits.
//!
//! The frontend cannot do this with `@tauri-apps/plugin-fs` alone: workspaces
//! routinely live outside `$HOME`, and a recursive walk from the frontend would
//! cost one IPC round trip per directory.

use super::validate::validate_cwd;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// The only extensions the Files screen shows and edits. Source files never
/// appear here — code review stays in the Changes drawer.
const DOC_EXTENSIONS: [&str; 3] = ["md", "txt", "markdown"];

/// Caps on the walk, so a stray home-directory workspace cannot hang the UI.
const MAX_DEPTH: usize = 8;
const MAX_ENTRIES: usize = 2000;

/// Largest file the editor will open.
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;

/// Gap of quiet before a changed path is announced. One save is several
/// filesystem events, and the frontend re-reads the file when it hears about
/// one, so this is a trailing edge — emitting on the first event would race a
/// half-written file.
const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(serde::Serialize)]
pub struct DocEntry {
    /// Forward-slash path relative to the workspace root — the tree key.
    pub rel_path: String,
    pub name: String,
    /// Directories are returned too, so the tree can show empty folders.
    pub is_dir: bool,
    pub size: u64,
    /// RFC3339, or None when the platform does not report mtime.
    pub modified: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PlanEntry {
    pub path: String,
    pub name: String,
    pub modified: Option<String>,
}

fn rfc3339(time: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()
}

/// True for the extensions the Files screen handles, case-insensitively.
fn is_doc_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| DOC_EXTENSIONS.iter().any(|d| ext.eq_ignore_ascii_case(d)))
}

/// Directories the walk never descends into. `.git` and `.svelte-kit` fall out
/// of the leading-dot rule; the rest are build and dependency output.
fn should_prune_dir(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist" | "build")
}

/// Every document under `root`, plus the directories on the way to them.
///
/// Sorted directories-first then case-insensitively by name, which also orders
/// each sibling group that way once the frontend rebuilds the tree — so it does
/// not have to re-sort.
fn walk_docs(root: &Path) -> Vec<DocEntry> {
    let mut entries: Vec<DocEntry> = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut depth_capped = false;

    'walk: while let Some((dir, depth)) = stack.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Skipping {} while walking docs: {}", dir.display(), e);
                continue;
            }
        };

        for entry in read_dir.flatten() {
            if entries.len() >= MAX_ENTRIES {
                log::warn!(
                    "Doc walk of {} hit the {} entry cap — the tree is truncated",
                    root.display(),
                    MAX_ENTRIES
                );
                break 'walk;
            }

            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let name = name.to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

            if is_dir {
                if should_prune_dir(&name) {
                    continue;
                }
                if depth + 1 < MAX_DEPTH {
                    stack.push((path.clone(), depth + 1));
                } else {
                    depth_capped = true;
                }
            } else if !is_doc_file(&path) {
                continue;
            }

            let Ok(rel) = path.strip_prefix(root) else {
                continue;
            };
            let metadata = entry.metadata().ok();

            entries.push(DocEntry {
                rel_path: rel.to_string_lossy().replace('\\', "/"),
                name,
                is_dir,
                size: if is_dir {
                    0
                } else {
                    metadata.as_ref().map(|m| m.len()).unwrap_or(0)
                },
                modified: metadata.and_then(|m| m.modified().ok()).map(rfc3339),
            });
        }
    }

    if depth_capped {
        log::warn!(
            "Doc walk of {} hit the depth cap of {} — deeper directories were skipped",
            root.display(),
            MAX_DEPTH
        );
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    entries
}

/// Markdown and text files under a workspace, directories included.
#[tauri::command(async)]
pub async fn list_workspace_docs(workspace_path: String) -> Result<Vec<DocEntry>, String> {
    validate_cwd(&workspace_path)?;
    tokio::task::spawn_blocking(move || Ok(walk_docs(Path::new(&workspace_path))))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

fn claude_plans_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".claude").join("plans"))
        .ok_or_else(|| "Could not resolve the home directory".to_string())
}

/// The `.md` files directly inside `dir`. `name` is the file stem, because the
/// real names are a slugified cwd plus a random suffix
/// (`c-users-me-github-atlas-atl-curried-thacker.md`), not a session id.
/// Matching a plan to a workspace happens in the frontend, where the workspace
/// list lives.
fn list_plans_in(dir: &Path) -> Result<Vec<PlanEntry>, String> {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(r) => r,
        // A fresh install has no plans directory.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {}", dir.display(), e)),
    };

    let mut plans: Vec<PlanEntry> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file()
            || !path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
        {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        plans.push(PlanEntry {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            modified: entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(rfc3339),
        });
    }

    plans.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(plans)
}

#[tauri::command(async)]
pub fn list_claude_plans() -> Result<Vec<PlanEntry>, String> {
    list_plans_in(&claude_plans_dir()?)
}

/// Absolute, and one of the document extensions — the Files screen is documents
/// only.
fn validate_doc_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(format!("Path must be absolute: {}", path.display()));
    }
    if !is_doc_file(&path) {
        return Err(format!(
            "Only .md, .markdown and .txt files can be opened here: {}",
            path.display()
        ));
    }
    Ok(path)
}

#[tauri::command(async)]
pub fn read_text_file_at(path: String) -> Result<String, String> {
    let path = validate_doc_path(&path)?;
    let metadata = std::fs::metadata(&path).map_err(|e| format!("{}: {}", path.display(), e))?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "{} is {} bytes — the editor opens files up to 2 MB",
            path.display(),
            metadata.len()
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path.display(), e))
}

#[tauri::command(async)]
pub fn write_text_file_at(path: String, contents: String) -> Result<(), String> {
    let path = validate_doc_path(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {}", path.display()))?;
    let name = path
        .file_name()
        .ok_or_else(|| format!("Path has no file name: {}", path.display()))?;

    // New notes land in directories that may not exist yet.
    std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    // Write through the resolved parent, so a symlinked directory cannot
    // redirect the write somewhere outside the tree the user picked.
    let real_parent =
        std::fs::canonicalize(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;

    std::fs::write(real_parent.join(name), contents)
        .map_err(|e| format!("{}: {}", path.display(), e))
}

/// One `notify` watcher per watched workspace. Dropping a watcher stops it and
/// disconnects its channel, which ends the matching debounce thread.
#[derive(Default)]
pub struct DocsWatchers(Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocsChangedEvent {
    workspace_path: String,
    rel_path: String,
}

/// The forward-slash path of a changed file relative to `root`, or `None` when
/// it is not a document the Files screen shows.
fn watched_rel_path(root: &Path, path: &Path) -> Option<String> {
    if !is_doc_file(path) {
        return None;
    }
    let rel = path.strip_prefix(root).ok()?;
    let names: Vec<&str> = rel
        .components()
        .map(|c| c.as_os_str().to_str())
        .collect::<Option<Vec<_>>>()?;
    let (_, dirs) = names.split_last()?;
    if dirs.iter().any(|d| should_prune_dir(d)) {
        return None;
    }
    Some(names.join("/"))
}

fn spawn_docs_watcher(
    app: AppHandle,
    workspace_path: String,
) -> Result<RecommendedWatcher, String> {
    let root = PathBuf::from(&workspace_path);
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
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        // Path -> when it was last touched. A path is announced once it has
        // been quiet for DEBOUNCE, so a burst of writes to one file collapses
        // into a single event while a second file still gets its own.
        let mut pending: HashMap<String, Instant> = HashMap::new();

        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(event) => {
                    if matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) {
                        for path in &event.paths {
                            if let Some(rel) = watched_rel_path(&root, path) {
                                pending.insert(rel, Instant::now());
                            }
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                // The watcher was dropped by `stop_docs_watch`.
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            let now = Instant::now();
            pending.retain(|rel_path, last_seen| {
                if now.duration_since(*last_seen) < DEBOUNCE {
                    return true;
                }
                let _ = app.emit(
                    "docs-changed",
                    DocsChangedEvent {
                        workspace_path: workspace_path.clone(),
                        rel_path: rel_path.clone(),
                    },
                );
                false
            });
        }
    });

    Ok(watcher)
}

/// Watch a workspace for document edits made outside Atlas. Changes then arrive
/// as debounced `docs-changed` events until `stop_docs_watch`.
#[tauri::command]
pub fn start_docs_watch(
    workspace_path: String,
    app: AppHandle,
    watchers: State<'_, DocsWatchers>,
) -> Result<(), String> {
    validate_cwd(&workspace_path)?;
    let mut watchers = watchers.0.lock().map_err(|e| e.to_string())?;
    if watchers.contains_key(&workspace_path) {
        return Ok(());
    }
    let watcher = spawn_docs_watcher(app, workspace_path.clone())?;
    watchers.insert(workspace_path, watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_docs_watch(
    workspace_path: String,
    watchers: State<'_, DocsWatchers>,
) -> Result<(), String> {
    let mut watchers = watchers.0.lock().map_err(|e| e.to_string())?;
    watchers.remove(&workspace_path);
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }

    fn rel_paths(entries: &[DocEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.rel_path.as_str()).collect()
    }

    #[test]
    fn doc_extensions_are_matched_case_insensitively() {
        assert!(is_doc_file(Path::new("/w/notes.md")));
        assert!(is_doc_file(Path::new("/w/NOTES.MD")));
        assert!(is_doc_file(Path::new("/w/notes.txt")));
        assert!(is_doc_file(Path::new("/w/notes.markdown")));
        assert!(!is_doc_file(Path::new("/w/main.rs")));
        assert!(!is_doc_file(Path::new("/w/ipc.ts")));
        assert!(!is_doc_file(Path::new("/w/README")));
    }

    #[test]
    fn walk_keeps_docs_and_prunes_build_and_vcs_dirs() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        touch(&root.join("README.md"));
        touch(&root.join("docs/guide.markdown"));
        touch(&root.join("src/main.rs"));
        touch(&root.join(".git/COMMIT_EDITMSG.md"));
        touch(&root.join("node_modules/pkg/readme.md"));
        touch(&root.join("target/debug/notes.txt"));

        let entries = walk_docs(root);
        let paths = rel_paths(&entries);

        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"docs/guide.markdown"));
        assert!(!paths.iter().any(|p| p.contains(".git")));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.contains("target")));
        assert!(!paths.iter().any(|p| p.ends_with(".rs")));
        // Directories come back even when they hold no documents.
        assert!(entries.iter().any(|e| e.rel_path == "src" && e.is_dir));
    }

    #[test]
    fn walk_stops_at_the_depth_cap() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        touch(&root.join("d1/d2/d3/d4/d5/d6/d7/within.md"));
        touch(&root.join("d1/d2/d3/d4/d5/d6/d7/d8/beyond.md"));

        let entries = walk_docs(root);
        let paths = rel_paths(&entries);

        assert!(paths.contains(&"d1/d2/d3/d4/d5/d6/d7/within.md"));
        assert!(!paths.iter().any(|p| p.ends_with("beyond.md")));
    }

    #[test]
    fn walk_sorts_directories_first_then_by_name() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        touch(&root.join("Alpha.md"));
        touch(&root.join("beta.md"));
        touch(&root.join("zeta/inner.md"));

        let entries = walk_docs(root);
        assert_eq!(entries[0].rel_path, "zeta");
        assert!(entries[0].is_dir);

        let files: Vec<&str> = entries
            .iter()
            .filter(|e| !e.is_dir)
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(files, vec!["Alpha.md", "beta.md", "inner.md"]);
    }

    #[test]
    fn write_text_file_at_refuses_a_source_path() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("main.rs");
        let err = write_text_file_at(
            path.to_string_lossy().to_string(),
            "fn main() {}".to_string(),
        )
        .unwrap_err();
        assert!(err.contains(".md"), "unexpected error: {}", err);
        assert!(!path.exists());
    }

    #[test]
    fn write_text_file_at_creates_parents_and_round_trips() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("notes/new/note.md");
        write_text_file_at(path.to_string_lossy().to_string(), "hello".to_string()).unwrap();
        assert_eq!(
            read_text_file_at(path.to_string_lossy().to_string()).unwrap(),
            "hello"
        );
    }

    #[test]
    fn list_plans_in_missing_directory_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(list_plans_in(&tmp.path().join("no-plans-here"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn list_plans_in_returns_markdown_stems() {
        let tmp = TempDir::new().unwrap();
        touch(&tmp.path().join("c-users-me-github-atlas-atl-curried-thacker.md"));
        touch(&tmp.path().join("notes.txt"));

        let plans = list_plans_in(tmp.path()).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].name, "c-users-me-github-atlas-atl-curried-thacker");
        assert!(plans[0].path.ends_with(".md"));
    }

    #[test]
    fn watched_paths_are_documents_outside_pruned_dirs() {
        let root = Path::new("/w");
        assert_eq!(
            watched_rel_path(root, Path::new("/w/docs/guide.md")),
            Some("docs/guide.md".to_string())
        );
        assert_eq!(watched_rel_path(root, Path::new("/w/src/main.rs")), None);
        assert_eq!(
            watched_rel_path(root, Path::new("/w/node_modules/pkg/readme.md")),
            None
        );
        assert_eq!(watched_rel_path(root, Path::new("/elsewhere/a.md")), None);
    }
}
