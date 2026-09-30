//! Files screen backend: the workspace document tree, `~/.claude/plans`,
//! reading and writing documents, and watching for external edits.
//!
//! This lives in Rust rather than the webview: workspaces routinely live
//! outside `$HOME`, a recursive walk from the frontend would cost one IPC round
//! trip per directory, and the webview has no filesystem access of its own.

use super::validate::validate_cwd;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// The extensions the Files screen shows and edits.
///
/// An allowlist rather than "anything that is not binary": the editor reads a
/// whole file into a textarea, so a `.png` or a `.pdf` reaching it renders as
/// mojibake. Add to this list to teach the screen a new file type — nothing
/// else needs to change, since a file with no Markdown preview simply opens in
/// the source pane.
const DOC_EXTENSIONS: &[&str] = &[
    // Prose.
    "md", "markdown", "txt", "rst", "adoc", // Web and app source.
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "svelte", "vue", "css", "scss", "less", "html", "htm",
    // Everything else people keep in a repo.
    "rs", "go", "py", "rb", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php",
    "lua", "sql", "sh", "bash", "zsh", "ps1", "r", // Config and data.
    "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "xml",
];

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

/// One child of a browsed directory, for the Open… dialog.
#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    /// Absolute.
    pub path: String,
    pub is_dir: bool,
    /// A document the editor can open. Never true for a directory.
    pub is_text: bool,
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

/// Every file the editor can open under a workspace, directories included.
#[tauri::command(async)]
pub async fn list_workspace_docs(workspace_path: String) -> Result<Vec<DocEntry>, String> {
    validate_cwd(&workspace_path)?;
    tokio::task::spawn_blocking(move || Ok(walk_docs(Path::new(&workspace_path))))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Every child of `dir`, one level deep and unfiltered.
///
/// `walk_docs` recurses and keeps only documents, which is the wrong shape for
/// a folder browser: the Open… dialog lists what is really in the folder and
/// greys out what it cannot open, so the folder looks like itself.
fn list_children(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("{}: {}", dir.display(), e))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            log::debug!("Skipping non-UTF-8 entry {}", path.display());
            continue;
        };
        // `DirEntry::file_type` does not follow symlinks, and a symlinked
        // folder (`/tmp`, a linked project) must still be navigable.
        let is_dir = path.is_dir();
        entries.push(DirEntry {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir,
            is_text: !is_dir && is_doc_file(&path),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// The contents of one directory, for the Open… dialog's browser.
#[tauri::command(async)]
pub async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    validate_cwd(&path)?;
    tokio::task::spawn_blocking(move || list_children(Path::new(&path)))
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
            "Not a file type the Files screen can open: {}",
            path.display()
        ));
    }
    Ok(path)
}

#[tauri::command(async)]
pub fn read_text_file_at(path: String) -> Result<String, String> {
    let path = validate_doc_path(&path)?;
    let file = std::fs::File::open(&path).map_err(|e| format!("{}: {}", path.display(), e))?;
    // A `.md` symlink to `/dev/zero` reports length 0, so check the handle is
    // a regular file, and cap the read itself rather than trusting a size that
    // can change between stat and read.
    let metadata = file
        .metadata()
        .map_err(|e| format!("{}: {}", path.display(), e))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("{}: {}", path.display(), e))?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(format!(
            "{} is larger than 2 MB — the editor opens files up to 2 MB",
            path.display()
        ));
    }
    String::from_utf8(bytes).map_err(|_| format!("{} is not a UTF-8 text file", path.display()))
}

/// Replace `target` with `contents` without ever leaving it truncated: write a
/// sibling temp file, flush it to disk, then rename over the original. A crash
/// or a full disk mid-save leaves the old file intact.
fn write_atomically(target: &Path, contents: &str) -> std::io::Result<()> {
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path has no parent directory or file name",
        ));
    };
    let existing = std::fs::metadata(target).ok();
    // Writing in place fails on a read-only file; a rename would not.
    if existing
        .as_ref()
        .is_some_and(|m| m.permissions().readonly())
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "file is read-only",
        ));
    }

    // Dot-prefixed and with no document extension, so the docs watcher and
    // the tree ignore it.
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(name);
    tmp_name.push(format!(".atlas-tmp-{}", std::process::id()));
    let tmp = dir.join(tmp_name);

    let written = (|| {
        // A stale temp from a crashed save would make `create_new` fail.
        let _ = std::fs::remove_file(&tmp);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(contents.as_bytes())?;
        // The rename swaps the inode, so carry the mode over.
        if let Some(meta) = &existing {
            file.set_permissions(meta.permissions())?;
        }
        file.sync_all()?;
        drop(file);
        // [UNVERIFIED on Windows] rename-over-existing fails there while
        // another process holds the target open without share-delete.
        std::fs::rename(&tmp, target)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

#[tauri::command(async)]
pub fn write_text_file_at(path: String, contents: String) -> Result<(), String> {
    let path = validate_doc_path(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {}", path.display()))?;

    // New notes land in directories that may not exist yet.
    std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;

    // Save through a symlinked file rather than replacing the link with a
    // regular file, as writing in place always did.
    let target = match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            std::fs::canonicalize(&path).map_err(|e| format!("{}: {}", path.display(), e))?
        }
        _ => path.clone(),
    };

    write_atomically(&target, &contents).map_err(|e| format!("{}: {}", path.display(), e))
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

/// The forward-slash path of a changed file relative to the workspace, or
/// `None` when it is not a document the Files screen shows.
///
/// `roots` is every spelling of the workspace an event path may arrive under,
/// because the two backends disagree: `notify`'s macOS watcher canonicalizes
/// the root and FSEvents reports its own resolved path, so a workspace reached
/// through a symlink (`/tmp` -> `/private/tmp`) never matches the path the UI
/// passed in — while on Windows the events are joined onto that path verbatim
/// and it is the *canonical* form (`\\?\C:\...`) that fails to strip.
fn watched_rel_path(roots: &[PathBuf], path: &Path) -> Option<String> {
    if !is_doc_file(path) {
        return None;
    }
    let rel = roots.iter().find_map(|root| path.strip_prefix(root).ok())?;
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
    // Both spellings of the root — see `watched_rel_path`. The raw one is kept
    // first because it is what the Windows backend reports.
    let mut roots = vec![root.clone()];
    match std::fs::canonicalize(&root) {
        Ok(canonical) if canonical != root => roots.push(canonical),
        Ok(_) => {}
        Err(e) => log::warn!("Could not canonicalize {}: {}", root.display(), e),
    }
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
                            if let Some(rel) = watched_rel_path(&roots, path) {
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

/// The `DocsWatchers` key for a workspace. `/a/b` and `/a/b/` are one
/// workspace; keyed by the raw string they got two watchers and every edit was
/// announced twice.
fn watch_key(workspace_path: &str) -> String {
    std::fs::canonicalize(workspace_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| workspace_path.to_string())
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
    let key = watch_key(&workspace_path);
    let mut watchers = watchers.0.lock().map_err(|e| e.to_string())?;
    if watchers.contains_key(&key) {
        return Ok(());
    }
    let watcher = spawn_docs_watcher(app, workspace_path)?;
    watchers.insert(key, watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_docs_watch(
    workspace_path: String,
    watchers: State<'_, DocsWatchers>,
) -> Result<(), String> {
    let mut watchers = watchers.0.lock().map_err(|e| e.to_string())?;
    watchers.remove(&watch_key(&workspace_path));
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
        // Source files are documents too — the screen edits a repo, not a
        // notebook. Preview is still Markdown-only; these open as source.
        assert!(is_doc_file(Path::new("/w/main.rs")));
        assert!(is_doc_file(Path::new("/w/ipc.TS")));
        assert!(is_doc_file(Path::new("/w/App.svelte")));
        // Still an allowlist: a file the editor would render as mojibake, and
        // one with no extension to match on, stay out.
        assert!(!is_doc_file(Path::new("/w/icon.png")));
        assert!(!is_doc_file(Path::new("/w/README")));
    }

    #[test]
    fn walk_keeps_docs_and_prunes_build_and_vcs_dirs() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        touch(&root.join("README.md"));
        touch(&root.join("docs/guide.markdown"));
        touch(&root.join("src/main.rs"));
        touch(&root.join("src/icon.png"));
        touch(&root.join(".git/COMMIT_EDITMSG.md"));
        touch(&root.join("node_modules/pkg/readme.md"));
        touch(&root.join("target/debug/notes.txt"));

        let entries = walk_docs(root);
        let paths = rel_paths(&entries);

        assert!(paths.contains(&"README.md"));
        assert!(paths.contains(&"docs/guide.markdown"));
        assert!(
            paths.contains(&"src/main.rs"),
            "source files are listed now"
        );
        assert!(!paths.iter().any(|p| p.contains(".git")));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.contains("target")));
        assert!(!paths.iter().any(|p| p.ends_with(".png")));
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
    fn list_children_is_flat_and_marks_only_documents() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        touch(&root.join("notes.md"));
        touch(&root.join("main.rs"));
        touch(&root.join("icon.png"));
        touch(&root.join("sub/deep.md"));

        let entries = list_children(root).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // Directories first, then by name — and nothing from inside `sub`, which
        // the dialog reaches by walking into it.
        assert_eq!(names, vec!["sub", "icon.png", "main.rs", "notes.md"]);

        let by_name = |n: &str| entries.iter().find(|e| e.name == n).unwrap();
        assert!(by_name("notes.md").is_text);
        assert!(by_name("main.rs").is_text);
        // Listed so the folder looks right, but the dialog greys it out.
        assert!(!by_name("icon.png").is_text);
        assert!(by_name("sub").is_dir && !by_name("sub").is_text);
    }

    #[test]
    fn write_text_file_at_refuses_a_path_the_editor_cannot_open() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("icon.png");
        assert!(write_text_file_at(
            path.to_string_lossy().to_string(),
            "not an image".to_string(),
        )
        .is_err());
        assert!(!path.exists());
    }

    #[test]
    fn write_replaces_contents_and_leaves_no_temp_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("note.md");
        std::fs::write(&path, "old").unwrap();
        write_text_file_at(path.to_string_lossy().to_string(), "new".to_string()).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let names: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("note.md")]);
    }

    #[cfg(unix)]
    #[test]
    fn write_keeps_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("private.md");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_text_file_at(path.to_string_lossy().to_string(), "new".to_string()).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn write_refuses_a_read_only_file_and_leaves_it_alone() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("locked.md");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).unwrap();

        assert!(write_text_file_at(path.to_string_lossy().to_string(), "new".to_string()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
    }

    #[cfg(unix)]
    #[test]
    fn write_saves_through_a_symlinked_file() {
        let tmp = TempDir::new().unwrap();
        let real = tmp.path().join("real/target.md");
        touch(&real);
        let link = tmp.path().join("note.md");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        write_text_file_at(link.to_string_lossy().to_string(), "new".to_string()).unwrap();

        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn read_refuses_a_device_behind_a_document_name() {
        let tmp = TempDir::new().unwrap();
        let link = tmp.path().join("zero.md");
        std::os::unix::fs::symlink("/dev/zero", &link).unwrap();
        assert!(read_text_file_at(link.to_string_lossy().to_string()).is_err());
    }

    #[test]
    fn read_rejects_an_oversized_file_and_non_utf8() {
        let tmp = TempDir::new().unwrap();
        let big = tmp.path().join("big.md");
        std::fs::write(&big, vec![b'a'; MAX_READ_BYTES as usize + 1]).unwrap();
        assert!(read_text_file_at(big.to_string_lossy().to_string()).is_err());

        let binary = tmp.path().join("bin.md");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        let err = read_text_file_at(binary.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("UTF-8"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn list_children_lets_the_dialog_enter_a_symlinked_folder() {
        let tmp = TempDir::new().unwrap();
        touch(&tmp.path().join("real/deep.md"));
        std::os::unix::fs::symlink(tmp.path().join("real"), tmp.path().join("link")).unwrap();

        let entries = list_children(tmp.path()).unwrap();
        let link = entries.iter().find(|e| e.name == "link").unwrap();
        assert!(link.is_dir);
        assert!(!link.is_text);
    }

    #[test]
    fn one_workspace_has_one_watch_key_however_it_is_spelled() {
        let tmp = TempDir::new().unwrap();
        let plain = tmp.path().to_string_lossy().to_string();
        let slashed = format!("{plain}{}", std::path::MAIN_SEPARATOR);
        assert_eq!(watch_key(&plain), watch_key(&slashed));
    }

    #[test]
    fn write_text_file_at_accepts_a_source_path() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("src/main.rs");
        write_text_file_at(
            path.to_string_lossy().to_string(),
            "fn main() {}".to_string(),
        )
        .unwrap();
        assert_eq!(
            read_text_file_at(path.to_string_lossy().to_string()).unwrap(),
            "fn main() {}"
        );
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
        touch(
            &tmp.path()
                .join("c-users-me-github-atlas-atl-curried-thacker.md"),
        );
        touch(&tmp.path().join("notes.txt"));

        let plans = list_plans_in(tmp.path()).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].name, "c-users-me-github-atlas-atl-curried-thacker");
        assert!(plans[0].path.ends_with(".md"));
    }

    #[test]
    fn watched_paths_are_documents_outside_pruned_dirs() {
        let roots = [PathBuf::from("/w")];
        assert_eq!(
            watched_rel_path(&roots, Path::new("/w/docs/guide.md")),
            Some("docs/guide.md".to_string())
        );
        assert_eq!(
            watched_rel_path(&roots, Path::new("/w/src/main.rs")),
            Some("src/main.rs".to_string())
        );
        assert_eq!(watched_rel_path(&roots, Path::new("/w/src/icon.png")), None);
        assert_eq!(
            watched_rel_path(&roots, Path::new("/w/node_modules/pkg/readme.md")),
            None
        );
        assert_eq!(watched_rel_path(&roots, Path::new("/elsewhere/a.md")), None);
    }

    #[test]
    fn watched_paths_match_any_spelling_of_the_root() {
        // The shape of a macOS event: the workspace was registered as `/tmp/w`
        // and FSEvents reports the resolved `/private/tmp/w`. Neither root can
        // strip both, which is why the watcher carries both.
        let roots = [PathBuf::from("/tmp/w"), PathBuf::from("/private/tmp/w")];
        assert_eq!(
            watched_rel_path(&roots, Path::new("/private/tmp/w/notes.md")),
            Some("notes.md".to_string())
        );
        assert_eq!(
            watched_rel_path(&roots, Path::new("/tmp/w/notes.md")),
            Some("notes.md".to_string())
        );
        assert_eq!(watched_rel_path(&roots, Path::new("/other/notes.md")), None);
    }

    #[test]
    fn canonicalizing_a_real_root_keeps_it_strippable() {
        // Guards the Windows half: `canonicalize` hands back a `\\?\C:\...`
        // verbatim path there, and the events never carry that prefix — so the
        // raw root has to stay in the list.
        let tmp = TempDir::new().unwrap();
        let raw = tmp.path().to_path_buf();
        let canonical = std::fs::canonicalize(&raw).unwrap();
        let roots = [raw.clone(), canonical.clone()];

        assert_eq!(
            watched_rel_path(&roots, &raw.join("notes.md")),
            Some("notes.md".to_string())
        );
        assert_eq!(
            watched_rel_path(&roots, &canonical.join("notes.md")),
            Some("notes.md".to_string())
        );
    }
}
