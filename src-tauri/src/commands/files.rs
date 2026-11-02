//! Files screen backend: the workspace document tree, `~/.claude/plans`,
//! reading and writing documents, and watching for external edits.
//!
//! This lives in Rust rather than the webview: workspaces routinely live
//! outside `$HOME`, a recursive walk from the frontend would cost one IPC round
//! trip per directory, and the webview has no filesystem access of its own.

use super::files_scope::FilesScope;
use super::validate::validate_cwd;
use crate::error::AtlasError;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;

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
/// `visits` counts every directory entry looked at, kept or not: a workspace
/// full of files the tree never shows would otherwise be walked without bound.
struct Limits {
    depth: usize,
    entries: usize,
    visits: usize,
}

const WALK_LIMITS: Limits = Limits {
    depth: 8,
    entries: 2000,
    visits: 100_000,
};

/// Most children `list_dir` returns for one folder.
const MAX_DIR_ENTRIES: usize = 5000;

/// Largest file the editor will open.
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;

/// Gap of quiet before a changed path is announced. One save is several
/// filesystem events, and the frontend re-reads the file when it hears about
/// one, so this is a trailing edge — emitting on the first event would race a
/// half-written file.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// A workspace's documents. `truncated` says the walk hit a cap (entry count,
/// visit count or depth), so the tree is incomplete.
#[derive(serde::Serialize, TS)]
#[ts(export)]
pub struct DocList {
    pub entries: Vec<DocEntry>,
    pub truncated: bool,
}

/// One folder's children; `truncated` says there were more than were returned.
#[derive(serde::Serialize, TS)]
#[ts(export)]
pub struct DirList {
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

#[derive(serde::Serialize, TS)]
#[ts(export)]
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

/// A document's text and the modification time it had when it was read, in
/// milliseconds since the Unix epoch. The editor hands that time back on save
/// (`write_text_file_at`'s `expected_mtime`) so an edit made by someone else in
/// between is noticed instead of overwritten.
#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct TextFile {
    pub contents: String,
    pub mtime: u64,
}

/// How a save ended. A file that changed on disk since it was read is a normal
/// outcome the editor resolves with the user, not an error.
#[derive(Debug, PartialEq, serde::Serialize, TS)]
#[ts(export)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WriteOutcome {
    /// Written; `mtime` is the new modification time.
    Saved { mtime: u64 },
    /// Nothing was written. `disk_mtime` is the file's current modification
    /// time, or `None` when it no longer exists.
    Conflict { disk_mtime: Option<u64> },
}

#[derive(serde::Serialize, TS)]
#[ts(export)]
pub struct PlanEntry {
    pub path: String,
    pub name: String,
    pub modified: Option<String>,
}

/// One child of a browsed directory, for the Open… dialog.
#[derive(serde::Serialize, TS)]
#[ts(export)]
pub struct DirEntry {
    pub name: String,
    /// Absolute.
    pub path: String,
    pub is_dir: bool,
    /// A document the editor can open. Never true for a directory.
    pub is_text: bool,
}

/// Modification time in milliseconds since the epoch; 0 when the platform does
/// not report one, which makes the conflict check a no-op for that file.
fn mtime_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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
/// Breadth-first, so when a cap cuts the walk short it is the deepest
/// directories that are missing, not an arbitrary subset. Sorted
/// directories-first then case-insensitively by name, which also orders each
/// sibling group that way once the frontend rebuilds the tree — so it does not
/// have to re-sort.
fn walk_docs(root: &Path, limits: &Limits) -> DocList {
    let mut entries: Vec<DocEntry> = Vec::new();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut visited = 0usize;
    let mut truncated = false;

    'walk: while let Some((dir, depth)) = queue.pop_front() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Skipping {} while walking docs: {}", dir.display(), e);
                continue;
            }
        };

        for entry in read_dir.flatten() {
            visited += 1;
            if visited > limits.visits {
                log::warn!(
                    "Doc walk of {} looked at {} entries — the tree is truncated",
                    root.display(),
                    limits.visits
                );
                truncated = true;
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
                if depth + 1 < limits.depth {
                    queue.push_back((path.clone(), depth + 1));
                } else {
                    truncated = true;
                }
            } else if !is_doc_file(&path) {
                continue;
            }

            if entries.len() >= limits.entries {
                log::warn!(
                    "Doc walk of {} hit the {} entry cap — the tree is truncated",
                    root.display(),
                    limits.entries
                );
                truncated = true;
                break 'walk;
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

    if truncated {
        log::warn!("Doc walk of {} is incomplete", root.display());
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    DocList { entries, truncated }
}

/// Every file the editor can open under a workspace, directories included.
#[tauri::command(async)]
pub async fn list_workspace_docs(
    workspace_path: String,
    scope: State<'_, FilesScope>,
) -> Result<DocList, AtlasError> {
    validate_cwd(&workspace_path)?;
    scope.resolve(&workspace_path)?;
    Ok(
        tokio::task::spawn_blocking(move || walk_docs(Path::new(&workspace_path), &WALK_LIMITS))
            .await?,
    )
}

/// Every child of `dir`, one level deep and unfiltered.
///
/// `walk_docs` recurses and keeps only documents, which is the wrong shape for
/// a folder browser: the Open… dialog lists what is really in the folder and
/// greys out what it cannot open, so the folder looks like itself.
fn list_children(dir: &Path) -> Result<DirList, AtlasError> {
    let read_dir = std::fs::read_dir(dir).map_err(|e| AtlasError::io_at(dir, &e))?;

    let mut entries: Vec<DirEntry> = Vec::new();
    let mut truncated = false;
    for entry in read_dir.flatten() {
        if entries.len() >= MAX_DIR_ENTRIES {
            log::warn!(
                "{} has more than {} entries — the listing is truncated",
                dir.display(),
                MAX_DIR_ENTRIES
            );
            truncated = true;
            break;
        }
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
    Ok(DirList { entries, truncated })
}

/// The contents of one directory, for the Open… dialog's browser.
#[tauri::command(async)]
pub async fn list_dir(path: String, scope: State<'_, FilesScope>) -> Result<DirList, AtlasError> {
    validate_cwd(&path)?;
    scope.resolve(&path)?;
    tokio::task::spawn_blocking(move || list_children(Path::new(&path))).await?
}

fn claude_plans_dir() -> Result<PathBuf, AtlasError> {
    dirs::home_dir()
        .map(|h| h.join(".claude").join("plans"))
        .ok_or_else(|| AtlasError::internal("Could not resolve the home directory"))
}

/// The `.md` files directly inside `dir`. `name` is the file stem, because the
/// real names are a slugified cwd plus a random suffix
/// (`c-users-me-github-atlas-atl-curried-thacker.md`), not a session id.
/// Matching a plan to a workspace happens in the frontend, where the workspace
/// list lives.
fn list_plans_in(dir: &Path) -> Result<Vec<PlanEntry>, AtlasError> {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(r) => r,
        // A fresh install has no plans directory.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AtlasError::io_at(dir, &e)),
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
pub fn list_claude_plans() -> Result<Vec<PlanEntry>, AtlasError> {
    list_plans_in(&claude_plans_dir()?)
}

/// Absolute, and one of the document extensions — the Files screen is documents
/// only.
fn validate_doc_path(path: &str) -> Result<PathBuf, AtlasError> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(AtlasError::invalid_input(format!(
            "Path must be absolute: {}",
            path.display()
        )));
    }
    if !is_doc_file(&path) {
        return Err(AtlasError::invalid_input(format!(
            "Not a file type the Files screen can open: {}",
            path.display()
        )));
    }
    Ok(path)
}

/// The scoped, canonical path for a document: a document extension, inside an
/// allowed root, not denied. The extension is checked on the resolved path as
/// well, so a `.md` symlink cannot expose a file that is not a document.
fn resolve_doc(scope: &FilesScope, path: &str) -> Result<PathBuf, AtlasError> {
    validate_doc_path(path)?;
    let resolved = scope.resolve(path)?;
    if !is_doc_file(&resolved) {
        return Err(AtlasError::invalid_input(format!(
            "Not a file type the Files screen can open: {}",
            resolved.display()
        )));
    }
    Ok(resolved)
}

fn read_file(scope: &FilesScope, path: &str) -> Result<TextFile, AtlasError> {
    let path = resolve_doc(scope, path)?;
    let file = std::fs::File::open(&path).map_err(|e| {
        // Windows refuses to open a directory ("Access is denied"); name it as one.
        if path.is_dir() {
            AtlasError::invalid_input(format!("{} is not a regular file", path.display()))
        } else {
            AtlasError::io_at(&path, &e)
        }
    })?;
    // A `.md` symlink to `/dev/zero` reports length 0, so check the handle is
    // a regular file, and cap the read itself rather than trusting a size that
    // can change between stat and read.
    let metadata = file.metadata().map_err(|e| AtlasError::io_at(&path, &e))?;
    if !metadata.is_file() {
        return Err(AtlasError::invalid_input(format!(
            "{} is not a regular file",
            path.display()
        )));
    }
    let mut bytes = Vec::new();
    file.take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| AtlasError::io_at(&path, &e))?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(AtlasError::invalid_input(format!(
            "{} is larger than 2 MB — the editor opens files up to 2 MB",
            path.display()
        )));
    }
    let contents = String::from_utf8(bytes)
        .map_err(|_| AtlasError::parse(format!("{} is not a UTF-8 text file", path.display())))?;
    Ok(TextFile {
        contents,
        mtime: mtime_ms(&metadata),
    })
}

#[tauri::command(async)]
pub fn read_text_file_at(
    path: String,
    scope: State<'_, FilesScope>,
) -> Result<TextFile, AtlasError> {
    read_file(&scope, &path)
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

/// Save `contents`. With `expected_mtime`, refuse (without writing) when the
/// file's modification time is no longer that — someone else saved it since it
/// was read, or it was deleted. `None` writes unconditionally, which is what a
/// brand-new note and an explicit "keep mine" want.
fn write_file(
    scope: &FilesScope,
    path: &str,
    contents: &str,
    expected_mtime: Option<u64>,
) -> Result<WriteOutcome, AtlasError> {
    // Already canonical: a symlinked file is written through to its target
    // rather than replaced by a regular file.
    let target = resolve_doc(scope, path)?;
    let parent = target.parent().ok_or_else(|| {
        AtlasError::invalid_input(format!(
            "Path has no parent directory: {}",
            target.display()
        ))
    })?;

    if let Some(expected) = expected_mtime {
        match std::fs::metadata(&target) {
            Ok(meta) if mtime_ms(&meta) != expected => {
                return Ok(WriteOutcome::Conflict {
                    disk_mtime: Some(mtime_ms(&meta)),
                })
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(WriteOutcome::Conflict { disk_mtime: None })
            }
            Err(e) => return Err(AtlasError::io_at(&target, &e)),
        }
    }

    // New notes land in directories that may not exist yet.
    std::fs::create_dir_all(parent).map_err(|e| AtlasError::io_at(parent, &e))?;

    write_atomically(&target, contents).map_err(|e| AtlasError::io_at(&target, &e))?;
    let meta = std::fs::metadata(&target).map_err(|e| AtlasError::io_at(&target, &e))?;
    Ok(WriteOutcome::Saved {
        mtime: mtime_ms(&meta),
    })
}

#[tauri::command(async)]
pub fn write_text_file_at(
    path: String,
    contents: String,
    expected_mtime: Option<u64>,
    scope: State<'_, FilesScope>,
) -> Result<WriteOutcome, AtlasError> {
    write_file(&scope, &path, &contents, expected_mtime)
}

// ── Create, rename, delete, export ────────────────────────────────────────────

/// Largest export `save_export` writes.
const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A single path component that is safe to create on every platform Atlas ships on.
fn validate_name(name: &str) -> Result<(), AtlasError> {
    let bad = |why: &str| {
        Err(AtlasError::invalid_input(format!(
            "Invalid name \"{name}\": {why}"
        )))
    };
    if name.is_empty() || name.chars().count() > 255 {
        return bad("must be 1 to 255 characters");
    }
    if name == "." || name == ".." {
        return bad("must not be . or ..");
    }
    if name
        .chars()
        .any(|c| c == '/' || c == '\\' || c.is_control())
    {
        return bad("must not contain separators or control characters");
    }
    if name.starts_with(' ') || name.ends_with(' ') {
        return bad("must not start or end with a space");
    }
    // Windows also strips trailing dots, and reserves `CON.txt` as well as `CON`.
    let stem = name.split('.').next().unwrap_or("").trim_end();
    if name.ends_with('.') || RESERVED_NAMES.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return bad("reserved on Windows");
    }
    Ok(())
}

/// `path` with its parent resolved through the scope and its last component
/// validated as a name. The link itself is operated on, never its target, and
/// the whole path must still pass the scope (so a symlink out is refused).
fn scoped_child(scope: &FilesScope, path: &str) -> Result<PathBuf, AtlasError> {
    let given = Path::new(path);
    let (Some(parent), Some(name)) = (given.parent(), given.file_name().and_then(|n| n.to_str()))
    else {
        return Err(AtlasError::invalid_input(format!(
            "Path has no parent directory or name: {path}"
        )));
    };
    validate_name(name)?;
    let child = scope.resolve(&parent.to_string_lossy())?.join(name);
    scope.resolve(&child.to_string_lossy())?;
    Ok(child)
}

fn exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

fn make_dir(scope: &FilesScope, path: &str) -> Result<(), AtlasError> {
    let child = scoped_child(scope, path)?;
    if exists(&child) {
        return Err(AtlasError::already_exists(format!(
            "Already exists: {}",
            child.display()
        )));
    }
    // Not `create_dir_all`: the parent must already exist.
    std::fs::create_dir(&child).map_err(|e| AtlasError::io_at(&child, &e))
}

fn move_path(scope: &FilesScope, from: &str, to: &str) -> Result<(), AtlasError> {
    let from = scoped_child(scope, from)?;
    let to = scoped_child(scope, to)?;
    if !exists(&from) {
        return Err(AtlasError::not_found(format!(
            "Not found: {}",
            from.display()
        )));
    }
    if scope.is_root(&from) {
        return Err(AtlasError::forbidden(format!(
            "Cannot move a workspace or Files root: {}",
            from.display()
        )));
    }
    if to.starts_with(&from) && to != from {
        return Err(AtlasError::invalid_input(format!(
            "Cannot move {} into itself",
            from.display()
        )));
    }
    // A case-only rename on a case-insensitive volume "exists" as the source.
    let case_only = to != from
        && to.parent() == from.parent()
        && to
            .to_string_lossy()
            .eq_ignore_ascii_case(&from.to_string_lossy());
    if exists(&to) && !case_only {
        return Err(AtlasError::already_exists(format!(
            "Already exists: {}",
            to.display()
        )));
    }
    std::fs::rename(&from, &to).map_err(|e| AtlasError::io_at(&from, &e))
}

fn remove_path(scope: &FilesScope, path: &str, permanent: bool) -> Result<(), AtlasError> {
    let child = scoped_child(scope, path)?;
    let meta = std::fs::symlink_metadata(&child).map_err(|e| AtlasError::io_at(&child, &e))?;
    if scope.is_root(&child) {
        return Err(AtlasError::forbidden(format!(
            "Cannot delete a workspace or Files root: {}",
            child.display()
        )));
    }
    if permanent {
        let removed = if meta.is_dir() {
            std::fs::remove_dir_all(&child)
        } else {
            std::fs::remove_file(&child)
        };
        return removed.map_err(|e| AtlasError::io_at(&child, &e));
    }
    trash::delete(&child).map_err(|e| {
        AtlasError::io(format!(
            "Could not move {} to the trash: {e}",
            child.display()
        ))
    })
}

/// Write an export to a path the user picked in the save dialog. The dialog
/// is the authority for where, so this is not limited to the Files roots; it
/// refuses everything that is not a plain new or replaced file.
fn write_export(path: &str, contents: &str) -> Result<(), AtlasError> {
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err(AtlasError::invalid_input(format!(
            "Path must be absolute: {path}"
        )));
    }
    if target
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(AtlasError::invalid_input(format!(
            "Path must not contain '..': {path}"
        )));
    }
    if contents.len() > MAX_EXPORT_BYTES {
        return Err(AtlasError::invalid_input("Export is larger than 16 MB"));
    }
    if target.is_dir() {
        return Err(AtlasError::invalid_input(format!(
            "{path} is a folder, not a file"
        )));
    }
    write_atomically(target, contents).map_err(|e| AtlasError::io_at(target, &e))
}

/// Create one folder; its parent must exist and the name must not.
#[tauri::command(async)]
pub fn create_dir(path: String, scope: State<'_, FilesScope>) -> Result<(), AtlasError> {
    make_dir(&scope, &path)
}

/// Rename or move within the allowed roots; never overwrites.
#[tauri::command(async)]
pub fn rename_path(
    from: String,
    to: String,
    scope: State<'_, FilesScope>,
) -> Result<(), AtlasError> {
    move_path(&scope, &from, &to)
}

/// Move to the OS trash. `permanent` deletes outright; the frontend leaves it unset.
#[tauri::command(async)]
pub fn delete_path(
    path: String,
    permanent: Option<bool>,
    scope: State<'_, FilesScope>,
) -> Result<(), AtlasError> {
    remove_path(&scope, &path, permanent.unwrap_or(false))
}

/// Save a CSV or JSON export to a path from the save dialog.
#[tauri::command(async)]
pub fn save_export(path: String, contents: String) -> Result<(), AtlasError> {
    write_export(&path, &contents)
}

/// Whether `path` is an existing absolute directory. A typed-in workspace path
/// is checked with this before it is added, so a typo never becomes a
/// workspace whose every session fails to spawn. It reads nothing, so it needs
/// no file scope.
#[tauri::command]
pub fn validate_directory(path: String) -> Result<(), AtlasError> {
    validate_cwd(&path)
}

/// One `notify` watcher per watched workspace. Dropping a watcher stops it and
/// disconnects its channel, which ends the matching debounce thread.
#[derive(Default)]
pub struct DocsWatchers(Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize, TS)]
#[ts(export)]
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
) -> Result<RecommendedWatcher, AtlasError> {
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
    )?;

    watcher.watch(&root, RecursiveMode::Recursive)?;

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
    scope: State<'_, FilesScope>,
) -> Result<(), AtlasError> {
    validate_cwd(&workspace_path)?;
    scope.resolve(&workspace_path)?;
    let key = watch_key(&workspace_path);
    let mut watchers = watchers.0.lock()?;
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
) -> Result<(), AtlasError> {
    let mut watchers = watchers.0.lock()?;
    watchers.remove(&watch_key(&workspace_path));
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// A scope that allows exactly the temp directory.
    fn scoped(dir: &TempDir) -> FilesScope {
        let scope = FilesScope::new(None);
        scope.grant(&dir.path().to_string_lossy()).unwrap();
        scope
    }

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

        let walked = walk_docs(root, &WALK_LIMITS);
        let entries = &walked.entries;
        let paths = rel_paths(entries);

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

        let walked = walk_docs(root, &WALK_LIMITS);
        let entries = &walked.entries;
        let paths = rel_paths(entries);

        assert!(paths.contains(&"d1/d2/d3/d4/d5/d6/d7/within.md"));
        assert!(!paths.iter().any(|p| p.ends_with("beyond.md")));
        assert!(walked.truncated, "a depth cut must be reported");
    }

    #[test]
    fn a_walk_that_fits_is_not_truncated() {
        let tmp = TempDir::new().unwrap();
        touch(&tmp.path().join("a.md"));
        touch(&tmp.path().join("docs/b.md"));
        assert!(!walk_docs(tmp.path(), &WALK_LIMITS).truncated);
    }

    #[test]
    fn hitting_the_entry_cap_is_reported_and_keeps_the_shallowest_entries() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for n in 0..6 {
            touch(&root.join(format!("top{n}.md")));
        }
        touch(&root.join("deep/er/still/buried.md"));
        // The six files and the `deep` folder fill the cap exactly.
        let limits = Limits {
            entries: 7,
            ..WALK_LIMITS
        };

        let walked = walk_docs(root, &limits);

        assert!(walked.truncated);
        assert_eq!(walked.entries.len(), 7);
        // Breadth-first: the cut falls on the deepest files, never on the top
        // level that was listed first.
        let paths = rel_paths(&walked.entries);
        assert!((0..6).all(|n| paths.contains(&format!("top{n}.md").as_str())));
        assert!(!paths.iter().any(|p| p.ends_with("buried.md")));
    }

    #[test]
    fn exactly_filling_the_entry_cap_is_not_truncation() {
        let tmp = TempDir::new().unwrap();
        for n in 0..4 {
            touch(&tmp.path().join(format!("n{n}.md")));
        }
        let limits = Limits {
            entries: 4,
            ..WALK_LIMITS
        };
        let walked = walk_docs(tmp.path(), &limits);
        assert_eq!(walked.entries.len(), 4);
        assert!(!walked.truncated);
    }

    #[test]
    fn files_the_tree_never_shows_still_count_against_the_visit_cap() {
        let tmp = TempDir::new().unwrap();
        for n in 0..40 {
            touch(&tmp.path().join(format!("blob{n}.bin")));
        }
        touch(&tmp.path().join("kept.md"));
        let limits = Limits {
            visits: 10,
            ..WALK_LIMITS
        };

        let walked = walk_docs(tmp.path(), &limits);

        assert!(walked.truncated, "40 skipped files must not be free");
    }

    #[test]
    fn a_huge_folder_listing_is_cut_and_reported() {
        let tmp = TempDir::new().unwrap();
        for n in 0..MAX_DIR_ENTRIES + 3 {
            std::fs::write(tmp.path().join(format!("f{n}.md")), "").unwrap();
        }
        let listed = list_children(tmp.path()).unwrap();
        assert_eq!(listed.entries.len(), MAX_DIR_ENTRIES);
        assert!(listed.truncated);

        let small = TempDir::new().unwrap();
        touch(&small.path().join("a.md"));
        assert!(!list_children(small.path()).unwrap().truncated);
    }

    #[test]
    fn walk_sorts_directories_first_then_by_name() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        touch(&root.join("Alpha.md"));
        touch(&root.join("beta.md"));
        touch(&root.join("zeta/inner.md"));

        let entries = walk_docs(root, &WALK_LIMITS).entries;
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

        let entries = list_children(root).unwrap().entries;
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
        let scope = scoped(&tmp);
        let path = tmp.path().join("icon.png");
        assert!(write_file(&scope, &path.to_string_lossy(), "not an image", None).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn write_replaces_contents_and_leaves_no_temp_file() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("note.md");
        std::fs::write(&path, "old").unwrap();
        write_file(&scope, &path.to_string_lossy(), "new", None).unwrap();

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
        let scope = scoped(&tmp);
        let path = tmp.path().join("private.md");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_file(&scope, &path.to_string_lossy(), "new", None).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn write_refuses_a_read_only_file_and_leaves_it_alone() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("locked.md");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).unwrap();

        assert!(write_file(&scope, &path.to_string_lossy(), "new", None).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
    }

    #[cfg(unix)]
    #[test]
    fn write_saves_through_a_symlinked_file() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let real = tmp.path().join("real/target.md");
        touch(&real);
        let link = tmp.path().join("note.md");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        write_file(&scope, &link.to_string_lossy(), "new", None).unwrap();

        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new");
    }

    #[test]
    fn read_refuses_something_that_is_not_a_regular_file_behind_a_document_name() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let dir = tmp.path().join("notes.md");
        std::fs::create_dir(&dir).unwrap();
        let err = read_file(&scope, &dir.to_string_lossy()).unwrap_err();
        assert!(matches!(err, AtlasError::InvalidInput { .. }), "{err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_document_symlink_to_a_device_is_refused() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let link = tmp.path().join("zero.md");
        std::os::unix::fs::symlink("/dev/zero", &link).unwrap();
        assert!(read_file(&scope, &link.to_string_lossy()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn read_and_write_refuse_a_symlink_that_leaves_the_folder() {
        let ws = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.md");
        std::fs::write(&secret, "outside").unwrap();
        let link = ws.path().join("leak.md");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let scope = scoped(&ws);

        assert!(read_file(&scope, &link.to_string_lossy()).is_err());
        assert!(write_file(&scope, &link.to_string_lossy(), "pwned", None).is_err());
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "outside");
    }

    #[test]
    fn write_refuses_a_path_outside_every_root_and_creates_nothing() {
        let ws = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let scope = scoped(&ws);
        let target = outside.path().join("new/dir/evil.sh");

        assert!(write_file(&scope, &target.to_string_lossy(), "evil", None).is_err());
        assert!(!outside.path().join("new").exists());
    }

    #[test]
    fn dot_dot_traversal_is_refused_on_read_and_write() {
        let ws = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("x.md"), "x").unwrap();
        let scope = scoped(&ws);
        let sneaky = format!(
            "{}/../{}/x.md",
            ws.path().display(),
            outside.path().file_name().unwrap().to_string_lossy()
        );

        assert!(read_file(&scope, &sneaky).is_err());
        assert!(write_file(&scope, &sneaky, "pwned", None).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("x.md")).unwrap(),
            "x"
        );
    }

    #[test]
    fn claude_settings_and_atlas_state_are_not_reachable_even_from_a_registered_home() {
        let home = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::create_dir_all(home.path().join(".atlas")).unwrap();
        std::fs::write(home.path().join(".claude/settings.json"), "{}").unwrap();
        std::fs::write(home.path().join(".atlas/settings.json"), "{}").unwrap();
        let scope = FilesScope::new(Some(std::fs::canonicalize(home.path()).unwrap()));
        scope.grant(&home.path().to_string_lossy()).unwrap();

        for denied in [".claude/settings.json", ".atlas/settings.json"] {
            let path = home.path().join(denied).to_string_lossy().to_string();
            assert!(read_file(&scope, &path).is_err(), "{denied}");
            assert!(
                write_file(&scope, &path, "{\"hooks\":1}", None).is_err(),
                "{denied}"
            );
            assert_eq!(
                std::fs::read_to_string(home.path().join(denied)).unwrap(),
                "{}"
            );
        }
    }

    #[test]
    fn read_rejects_an_oversized_file_and_non_utf8() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let big = tmp.path().join("big.md");
        std::fs::write(&big, vec![b'a'; MAX_READ_BYTES as usize + 1]).unwrap();
        assert!(read_file(&scope, &big.to_string_lossy()).is_err());

        let binary = tmp.path().join("bin.md");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        let err = read_file(&scope, &binary.to_string_lossy()).unwrap_err();
        assert!(matches!(err, AtlasError::Parse { .. }), "{err:?}");
    }

    #[cfg(unix)]
    #[test]
    fn list_children_lets_the_dialog_enter_a_symlinked_folder() {
        let tmp = TempDir::new().unwrap();
        touch(&tmp.path().join("real/deep.md"));
        std::os::unix::fs::symlink(tmp.path().join("real"), tmp.path().join("link")).unwrap();

        let entries = list_children(tmp.path()).unwrap().entries;
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
        let scope = scoped(&tmp);
        let path = tmp.path().join("src/main.rs");
        write_file(&scope, &path.to_string_lossy(), "fn main() {}", None).unwrap();
        assert_eq!(
            read_file(&scope, &path.to_string_lossy()).unwrap().contents,
            "fn main() {}"
        );
    }

    #[test]
    fn write_text_file_at_creates_parents_and_round_trips() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("notes/new/note.md");
        write_file(&scope, &path.to_string_lossy(), "hello", None).unwrap();
        assert_eq!(
            read_file(&scope, &path.to_string_lossy()).unwrap().contents,
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

    /// Backdate a file's mtime, standing in for someone else saving it later.
    fn set_mtime_ms(path: &Path, ms: u64) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(std::time::UNIX_EPOCH + Duration::from_millis(ms))
            .unwrap();
    }

    #[test]
    fn read_reports_the_files_mtime_in_milliseconds() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "x").unwrap();
        set_mtime_ms(&path, 1_700_000_123_456);

        let file = read_file(&scope, &path.to_string_lossy()).unwrap();

        assert_eq!(file.mtime, 1_700_000_123_456);
    }

    #[test]
    fn a_save_with_the_mtime_it_read_succeeds_and_reports_the_new_one() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "old").unwrap();
        set_mtime_ms(&path, 1_700_000_000_000);
        let path = path.to_string_lossy().to_string();

        let outcome = write_file(&scope, &path, "new", Some(1_700_000_000_000)).unwrap();

        let WriteOutcome::Saved { mtime } = outcome else {
            panic!("expected a save, got {outcome:?}");
        };
        assert_eq!(read_file(&scope, &path).unwrap().mtime, mtime);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn a_save_over_a_file_someone_else_changed_is_a_conflict_and_writes_nothing() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "theirs").unwrap();
        set_mtime_ms(&path, 1_700_000_999_000);

        let outcome = write_file(
            &scope,
            &path.to_string_lossy(),
            "mine",
            Some(1_700_000_000_000),
        )
        .unwrap();

        assert_eq!(
            outcome,
            WriteOutcome::Conflict {
                disk_mtime: Some(1_700_000_999_000)
            }
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "theirs");
    }

    #[test]
    fn a_save_over_a_file_deleted_since_it_was_read_is_a_conflict_and_does_not_recreate_it() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("gone.md");

        let outcome = write_file(
            &scope,
            &path.to_string_lossy(),
            "mine",
            Some(1_700_000_000_000),
        )
        .unwrap();

        assert_eq!(outcome, WriteOutcome::Conflict { disk_mtime: None });
        assert!(!path.exists());
    }

    #[test]
    fn a_save_with_no_expected_mtime_overwrites_whatever_is_there() {
        let tmp = TempDir::new().unwrap();
        let scope = scoped(&tmp);
        let path = tmp.path().join("a.md");
        std::fs::write(&path, "theirs").unwrap();
        set_mtime_ms(&path, 1_700_000_999_000);

        let outcome = write_file(&scope, &path.to_string_lossy(), "mine", None).unwrap();

        assert!(matches!(outcome, WriteOutcome::Saved { .. }));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "mine");
    }

    // ── create / rename / delete / export ─────────────────────────────────

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn names_are_validated() {
        for ok in ["notes", "a b", "x.md", ".hidden", "CONSOLE"] {
            assert!(validate_name(ok).is_ok(), "{ok}");
        }
        let long = "a".repeat(256);
        for bad in [
            "", "..", ".", "a/b", "a\\b", " a", "a ", "con", "NUL", "Com1", "nul.txt", "a.", &long,
        ] {
            assert!(validate_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn create_dir_succeeds_and_rejects() {
        let dir = TempDir::new().unwrap();
        let scope = scoped(&dir);
        let new = dir.path().join("new");
        make_dir(&scope, &s(&new)).unwrap();
        assert!(new.is_dir());
        assert!(matches!(
            make_dir(&scope, &s(&new)),
            Err(AtlasError::AlreadyExists { .. })
        ));
        // Parent missing: not recursive.
        assert!(make_dir(&scope, &s(&dir.path().join("a").join("b"))).is_err());
        assert!(matches!(
            make_dir(&scope, &s(&dir.path().join("CON"))),
            Err(AtlasError::InvalidInput { .. })
        ));
        assert!(matches!(
            make_dir(&scope, &format!("{}/x/../y", dir.path().display())),
            Err(AtlasError::InvalidInput { .. })
        ));
        let other = TempDir::new().unwrap();
        assert!(matches!(
            make_dir(&scope, &s(&other.path().join("out"))),
            Err(AtlasError::Forbidden { .. })
        ));
        assert!(make_dir(&scope, "relative").is_err());
    }

    #[test]
    fn rename_moves_and_rejects() {
        let dir = TempDir::new().unwrap();
        let scope = scoped(&dir);
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        touch(&a);
        touch(&dir.path().join("taken.md"));
        move_path(&scope, &s(&a), &s(&b)).unwrap();
        assert!(!a.exists() && b.exists());
        assert!(matches!(
            move_path(&scope, &s(&b), &s(&dir.path().join("taken.md"))),
            Err(AtlasError::AlreadyExists { .. })
        ));
        assert!(matches!(
            move_path(&scope, &s(&a), &s(&dir.path().join("c.md"))),
            Err(AtlasError::NotFound { .. })
        ));
        assert!(matches!(
            move_path(&scope, &s(&b), &s(&dir.path().join("LPT1"))),
            Err(AtlasError::InvalidInput { .. })
        ));
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        assert!(matches!(
            move_path(&scope, &s(&sub), &s(&sub.join("inner"))),
            Err(AtlasError::InvalidInput { .. })
        ));
        let other = TempDir::new().unwrap();
        assert!(matches!(
            move_path(&scope, &s(&b), &s(&other.path().join("b.md"))),
            Err(AtlasError::Forbidden { .. })
        ));
        assert!(matches!(
            move_path(
                &scope,
                &s(&other.path().join("z")),
                &s(&dir.path().join("z"))
            ),
            Err(AtlasError::Forbidden { .. })
        ));
        assert!(b.exists());
    }

    #[test]
    fn windows_separators_are_handled() {
        let dir = TempDir::new().unwrap();
        let scope = scoped(&dir);
        // A backslash is a separator on Windows and part of a name elsewhere;
        // either way the result must not escape or be created as a name.
        assert!(make_dir(&scope, &format!("{}/a\\b", dir.path().display())).is_err());
        #[cfg(windows)]
        {
            let new = format!("{}\\win", dir.path().display());
            make_dir(&scope, &new).unwrap();
            assert!(dir.path().join("win").is_dir());
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_refused() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let scope = scoped(&dir);
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(matches!(
            make_dir(&scope, &s(&link.join("x"))),
            Err(AtlasError::Forbidden { .. })
        ));
        assert!(remove_path(&scope, &s(&link), true).is_err());
        assert!(outside.path().exists());
    }

    #[test]
    fn delete_removes_and_rejects() {
        let dir = TempDir::new().unwrap();
        let scope = scoped(&dir);
        let f = dir.path().join("f.md");
        touch(&f);
        remove_path(&scope, &s(&f), true).unwrap();
        assert!(!f.exists());
        assert!(matches!(
            remove_path(&scope, &s(&f), true),
            Err(AtlasError::NotFound { .. })
        ));
        // The scope root itself.
        assert!(remove_path(&scope, &s(dir.path()), true).is_err());
        assert!(dir.path().exists());
        let other = TempDir::new().unwrap();
        touch(&other.path().join("o.md"));
        assert!(matches!(
            remove_path(&scope, &s(&other.path().join("o.md")), true),
            Err(AtlasError::Forbidden { .. })
        ));
        assert!(other.path().join("o.md").exists());
    }

    #[test]
    fn export_writes_and_rejects() {
        let dir = TempDir::new().unwrap();
        let out = dir.path().join("out.csv");
        write_export(&s(&out), "a,b\n").unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "a,b\n");
        assert!(write_export("out.csv", "x").is_err());
        assert!(write_export(&s(dir.path()), "x").is_err());
        assert!(write_export(&format!("{}/../x.csv", dir.path().display()), "x").is_err());
        assert!(write_export(&s(&out), &"x".repeat(MAX_EXPORT_BYTES + 1)).is_err());
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "a,b\n");
    }
}
