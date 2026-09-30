//! Which paths the Files commands may touch.
//!
//! The Files screen reads and writes documents at paths the webview names. Left
//! unscoped, a compromised webview could overwrite `~/.claude/settings.json`
//! (a hook there is command execution the next time Claude Code starts) or any
//! sourced shell script. So the roots are decided here, from Rust's own reads
//! of state the user created:
//!
//! - every registered (and not hidden) workspace in `~/.atlas/workspaces.json`;
//! - every folder registered under "From disk" (`fileSources` in
//!   `~/.atlas/settings.json`);
//! - `~/.claude/plans`;
//! - folders granted for this run through `files_grant`, which the frontend
//!   calls right after the user picks a folder in the native dialog.
//!
//! Whatever the roots say, `~/.atlas/**` and `~/.claude/settings*.json` are
//! never reachable through these commands.
//!
//! This is defence in depth, not a boundary: a script running in the webview can
//! still call `state_save` (and so register a workspace) or `files_grant`. What
//! it removes is the ability to reach arbitrary paths by naming them, and it
//! keeps a path-traversal or symlink bug in the UI from turning into a write
//! outside the folders the user opened. The content security policy is what
//! keeps hostile script out of the webview in the first place.

use crate::state::{read_json, StateFile};
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

pub struct FilesScope {
    home: Option<PathBuf>,
    /// Canonical folders granted this run.
    granted: Mutex<Vec<PathBuf>>,
}

impl FilesScope {
    pub fn new(home: Option<PathBuf>) -> Self {
        Self {
            home,
            granted: Mutex::new(Vec::new()),
        }
    }

    fn atlas_dir(&self) -> Option<PathBuf> {
        self.home.as_ref().map(|h| h.join(".atlas"))
    }

    /// Every allowed root that exists, canonical. A root that is gone, or
    /// cannot be resolved, is simply not a root.
    fn roots(&self) -> Vec<PathBuf> {
        let mut raw: Vec<PathBuf> = Vec::new();
        if let Some(home) = &self.home {
            raw.push(home.join(".claude").join("plans"));
        }
        if let Some(dir) = self.atlas_dir() {
            if let Some(workspaces) = read_json(&dir, StateFile::Workspaces) {
                let hidden: Vec<&str> = workspaces
                    .get("removedWorkspaces")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|p| p.as_str()).collect())
                    .unwrap_or_default();
                // The oldest shape was a bare array of workspaces.
                let list = workspaces
                    .get("workspaces")
                    .and_then(|v| v.as_array())
                    .or_else(|| workspaces.as_array());
                for entry in list.into_iter().flatten() {
                    if let Some(path) = entry.get("path").and_then(|p| p.as_str()) {
                        if !hidden.contains(&path) {
                            raw.push(PathBuf::from(path));
                        }
                    }
                }
            }
            if let Some(settings) = read_json(&dir, StateFile::Settings) {
                for source in settings
                    .get("fileSources")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                {
                    if let Some(path) = source.as_str() {
                        raw.push(PathBuf::from(path));
                    }
                }
            }
        }
        let mut roots: Vec<PathBuf> = raw
            .into_iter()
            .filter(|p| p.is_absolute())
            .filter_map(|p| std::fs::canonicalize(p).ok())
            .collect();
        if let Ok(granted) = self.granted.lock() {
            roots.extend(granted.iter().cloned());
        }
        roots
    }

    /// True for the paths no root can grant: Atlas's own state, and Claude
    /// Code's `settings*.json` files.
    fn is_denied(&self, resolved: &Path) -> bool {
        let Some(home) = &self.home else {
            return false;
        };
        if let Some(atlas) = self.atlas_dir().and_then(|d| resolve_lenient(&d).ok()) {
            if resolved.starts_with(&atlas) {
                return true;
            }
        }
        let Ok(claude) = resolve_lenient(&home.join(".claude")) else {
            return false;
        };
        if resolved.parent() == Some(claude.as_path()) && is_claude_settings_name(resolved) {
            return true;
        }
        // A `settings.json` that is a symlink into, say, a dotfiles repo
        // resolves outside `~/.claude`; deny where it really lives too.
        std::fs::read_dir(&claude)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| is_claude_settings_name(&entry.path()))
            .filter_map(|entry| std::fs::canonicalize(entry.path()).ok())
            .any(|target| target == resolved)
    }

    /// The canonical form of `path` (its deepest existing ancestor resolved,
    /// symlinks followed, the rest appended) when it lies inside an allowed
    /// root and is not denied. Callers use the returned path, not the one they
    /// passed, so a symlink swapped in afterwards cannot redirect the access.
    pub fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        let path = Path::new(path);
        if !path.is_absolute() {
            return Err(format!("Path must be absolute: {}", path.display()));
        }
        if path.components().any(|c| c == Component::ParentDir) {
            return Err(format!("Path must not contain '..': {}", path.display()));
        }
        let resolved = resolve_lenient(path).map_err(|e| format!("{}: {}", path.display(), e))?;
        if self.is_denied(&resolved) {
            return Err(format!(
                "Atlas does not open its own state or Claude Code's settings: {}",
                path.display()
            ));
        }
        if !self.roots().iter().any(|root| resolved.starts_with(root)) {
            return Err(format!(
                "Not inside a workspace or a folder added to Files: {}",
                path.display()
            ));
        }
        Ok(resolved)
    }

    /// Allow a folder the user just picked in the native dialog, for this run.
    /// The choice is persisted separately (as a workspace or a file source).
    pub fn grant(&self, path: &str) -> Result<(), String> {
        let path = Path::new(path);
        if !path.is_absolute() {
            return Err(format!("Path must be absolute: {}", path.display()));
        }
        let canonical =
            std::fs::canonicalize(path).map_err(|e| format!("{}: {}", path.display(), e))?;
        if !canonical.is_dir() {
            return Err(format!("Not a folder: {}", path.display()));
        }
        if self.is_denied(&canonical) {
            return Err(format!(
                "Atlas does not open its own state: {}",
                path.display()
            ));
        }
        let mut granted = self.granted.lock().map_err(|e| e.to_string())?;
        if !granted.contains(&canonical) {
            granted.push(canonical);
        }
        Ok(())
    }
}

/// `settings.json`, `settings.local.json`, … — case-insensitively, because
/// macOS and Windows volumes are.
fn is_claude_settings_name(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .is_some_and(|name| name.starts_with("settings") && name.ends_with(".json"))
}

/// `canonicalize`, but for a path whose tail may not exist yet: the deepest
/// existing ancestor is canonicalised and the missing components are appended.
/// The caller has already refused `..`, so the appended part cannot climb out.
fn resolve_lenient(path: &Path) -> std::io::Result<PathBuf> {
    let mut missing: Vec<&OsStr> = Vec::new();
    let mut current = path;
    loop {
        match std::fs::canonicalize(current) {
            Ok(mut resolved) => {
                resolved.extend(missing.iter().rev());
                return Ok(resolved);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let (Some(parent), Some(name)) = (current.parent(), current.file_name()) else {
                    return Err(e);
                };
                missing.push(name);
                current = parent;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Register a folder the user picked in the native dialog.
#[tauri::command]
pub fn files_grant(path: String, scope: State<'_, FilesScope>) -> Result<(), String> {
    scope.grant(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// A fake home with `.atlas` and `.claude`, plus a scope over it.
    fn fixture() -> (TempDir, FilesScope) {
        let home = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".atlas")).unwrap();
        std::fs::create_dir_all(home.path().join(".claude/plans")).unwrap();
        let scope = FilesScope::new(Some(std::fs::canonicalize(home.path()).unwrap()));
        (home, scope)
    }

    fn write_state(home: &TempDir, name: &str, json: &str) {
        std::fs::write(home.path().join(".atlas").join(name), json).unwrap();
    }

    fn s(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    #[test]
    fn workspaces_sources_and_plans_are_roots_and_everything_else_is_not() {
        let (home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        let src = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();
        write_state(
            &home,
            "workspaces.json",
            &serde_json::json!({ "version": 1, "workspaces": [{ "path": s(ws.path()) }] })
                .to_string(),
        );
        write_state(
            &home,
            "settings.json",
            &serde_json::json!({ "fileSources": [s(src.path())] }).to_string(),
        );

        assert!(scope.resolve(&s(&ws.path().join("a.md"))).is_ok());
        assert!(scope.resolve(&s(&src.path().join("b.md"))).is_ok());
        assert!(scope
            .resolve(&s(&home.path().join(".claude/plans/p.md")))
            .is_ok());
        assert!(scope.resolve(&s(&other.path().join("c.md"))).is_err());
    }

    #[test]
    fn a_hidden_workspace_is_no_longer_a_root() {
        let (home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        write_state(
            &home,
            "workspaces.json",
            &serde_json::json!({
                "workspaces": [{ "path": s(ws.path()) }],
                "removedWorkspaces": [s(ws.path())],
            })
            .to_string(),
        );
        assert!(scope.resolve(&s(&ws.path().join("a.md"))).is_err());
    }

    #[test]
    fn the_legacy_bare_array_workspaces_file_still_counts() {
        let (home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        write_state(
            &home,
            "workspaces.json",
            &serde_json::json!([{ "path": s(ws.path()) }]).to_string(),
        );
        assert!(scope.resolve(&s(&ws.path().join("a.md"))).is_ok());
    }

    #[test]
    fn a_granted_folder_is_a_root_for_this_run() {
        let (_home, scope) = fixture();
        let picked = TempDir::new().unwrap();
        assert!(scope.resolve(&s(&picked.path().join("a.md"))).is_err());
        scope.grant(&s(picked.path())).unwrap();
        assert!(scope.resolve(&s(&picked.path().join("a.md"))).is_ok());
    }

    #[test]
    fn grant_refuses_a_file_a_relative_path_and_atlas_state() {
        let (home, scope) = fixture();
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("f.md");
        std::fs::write(&file, "x").unwrap();
        assert!(scope.grant(&s(&file)).is_err());
        assert!(scope.grant("relative/dir").is_err());
        assert!(scope.grant(&s(&home.path().join(".atlas"))).is_err());
        assert!(scope.grant(&s(&dir.path().join("missing"))).is_err());
    }

    #[test]
    fn dot_dot_is_refused_even_when_it_would_land_inside_a_root() {
        let (_home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        scope.grant(&s(ws.path())).unwrap();
        std::fs::create_dir_all(ws.path().join("sub")).unwrap();
        let sneaky = format!("{}/sub/../a.md", ws.path().display());
        assert!(scope.resolve(&sneaky).is_err());
    }

    #[test]
    fn traversal_out_of_a_root_is_refused() {
        let (_home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        scope.grant(&s(ws.path())).unwrap();
        let escape = format!(
            "{}/../{}/x.md",
            ws.path().display(),
            outside.path().file_name().unwrap().to_string_lossy()
        );
        assert!(scope.resolve(&escape).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_root_is_refused_for_files_and_for_new_files_beneath_it() {
        let (_home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), ws.path().join("link.md"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("linkdir")).unwrap();
        scope.grant(&s(ws.path())).unwrap();

        assert!(scope.resolve(&s(&ws.path().join("link.md"))).is_err());
        // A file that does not exist yet, under a directory link that leaves
        // the root: the deepest existing ancestor is what gets resolved.
        assert!(scope
            .resolve(&s(&ws.path().join("linkdir/new.md")))
            .is_err());
        // A link that stays inside the root is fine.
        std::fs::write(ws.path().join("real.md"), "x").unwrap();
        std::os::unix::fs::symlink(ws.path().join("real.md"), ws.path().join("inside.md")).unwrap();
        assert!(scope.resolve(&s(&ws.path().join("inside.md"))).is_ok());
    }

    #[test]
    fn atlas_state_and_claude_settings_are_denied_even_under_a_granted_root() {
        let (home, scope) = fixture();
        // A user who registers their whole home directory still cannot reach
        // these through the Files commands.
        write_state(
            &home,
            "workspaces.json",
            &serde_json::json!({ "workspaces": [{ "path": s(home.path()) }] }).to_string(),
        );
        for denied in [
            ".atlas/settings.json",
            ".atlas/logs/atlas-backend-2026.log",
            ".atlas/sessions/abc/panel.json",
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".claude/SETTINGS.JSON",
        ] {
            assert!(
                scope.resolve(&s(&home.path().join(denied))).is_err(),
                "{denied} must be denied"
            );
        }
        // Neighbours are not caught by the deny list.
        assert!(scope
            .resolve(&s(&home.path().join(".claude/plans/p.md")))
            .is_ok());
        assert!(scope
            .resolve(&s(&home.path().join(".claude/commands/x.md")))
            .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_settings_json_symlinked_elsewhere_is_denied_at_its_real_location() {
        let (home, scope) = fixture();
        let dotfiles = TempDir::new().unwrap();
        std::fs::write(dotfiles.path().join("claude-settings.json"), "{}").unwrap();
        std::os::unix::fs::symlink(
            dotfiles.path().join("claude-settings.json"),
            home.path().join(".claude/settings.json"),
        )
        .unwrap();
        scope.grant(&s(dotfiles.path())).unwrap();

        assert!(scope
            .resolve(&s(&dotfiles.path().join("claude-settings.json")))
            .is_err());
        assert!(scope
            .resolve(&s(&home.path().join(".claude/settings.json")))
            .is_err());
    }

    #[test]
    fn a_relative_path_is_refused() {
        let (_home, scope) = fixture();
        assert!(scope.resolve("notes/a.md").is_err());
    }

    #[test]
    fn a_new_file_under_a_missing_directory_resolves_beneath_its_root() {
        let (_home, scope) = fixture();
        let ws = TempDir::new().unwrap();
        scope.grant(&s(ws.path())).unwrap();
        let resolved = scope
            .resolve(&s(&ws.path().join("notes/new/n.md")))
            .unwrap();
        assert!(resolved.starts_with(std::fs::canonicalize(ws.path()).unwrap()));
        assert!(resolved.ends_with("notes/new/n.md"));
    }

    #[test]
    fn without_a_home_directory_only_grants_count() {
        let scope = FilesScope::new(None);
        let picked = TempDir::new().unwrap();
        assert!(scope.resolve(&s(&picked.path().join("a.md"))).is_err());
        scope.grant(&s(picked.path())).unwrap();
        assert!(scope.resolve(&s(&picked.path().join("a.md"))).is_ok());
    }
}
