//! Atlas's own state files (`~/.atlas/settings.json`, `~/.atlas/workspaces.json`).
//!
//! The webview used to read and write these through `@tauri-apps/plugin-fs`,
//! which truncates in place, cannot serialise overlapping writes, and forced a
//! `$HOME`-wide filesystem grant on the whole window. Now Rust owns the paths:
//! the webview names one of a closed set of files, never a path.
//!
//! Guarantees:
//! - writes are serialised behind one mutex and are atomic (tmp + fsync +
//!   rename), so a reader sees the old or the new file, never a mix;
//! - a file that does not parse is copied to `<name>.json.bak` before anything
//!   can replace it — on load *and* on save, so a caller that skipped loading
//!   still cannot destroy the only copy;
//! - a file written by a newer Atlas (higher top-level `version`) is kept once
//!   as `<name>.json.v<N>.bak` before an older build overwrites it.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// The files the webview may load and save. A closed set: the path is built
/// here, never taken from the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StateFile {
    Settings,
    Workspaces,
}

impl StateFile {
    fn file_name(self) -> &'static str {
        match self {
            StateFile::Settings => "settings.json",
            StateFile::Workspaces => "workspaces.json",
        }
    }
}

/// Larger than any plausible settings or workspaces file; a bound so a runaway
/// caller cannot fill the disk through this command.
const MAX_STATE_BYTES: usize = 32 * 1024 * 1024;

/// What `state_load` returns.
#[derive(Debug, Serialize, PartialEq)]
pub struct StateLoad {
    /// The file's JSON text, or `None` when it is missing or was unusable.
    pub contents: Option<String>,
    /// True when the file was unusable and a `.bak` copy was made. The UI says
    /// so once, so the user knows why their settings reset.
    pub recovered: bool,
}

/// Owns `~/.atlas` for the two state files.
pub struct StateStore {
    dir: Option<PathBuf>,
    /// Held across every load and save: recovery copies and atomic writes must
    /// not interleave.
    lock: Mutex<()>,
}

impl StateStore {
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self {
            dir,
            lock: Mutex::new(()),
        }
    }

    fn path(&self, file: StateFile) -> Result<PathBuf, String> {
        let dir = self
            .dir
            .as_ref()
            .ok_or_else(|| "Could not resolve the home directory".to_string())?;
        Ok(dir.join(file.file_name()))
    }

    pub fn load(&self, file: StateFile) -> Result<StateLoad, String> {
        let path = self.path(file)?;
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        let text = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(StateLoad {
                    contents: None,
                    recovered: false,
                })
            }
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        match parse_state(&text) {
            Some(contents) => Ok(StateLoad {
                contents: Some(contents),
                recovered: false,
            }),
            None => {
                copy_aside(&path, &bak_path(&path, None))
                    .map_err(|e| format!("could not back up {}: {e}", path.display()))?;
                log::error!(
                    "{} is not valid JSON; copied it to {} and starting from defaults",
                    path.display(),
                    bak_path(&path, None).display()
                );
                Ok(StateLoad {
                    contents: None,
                    recovered: true,
                })
            }
        }
    }

    pub fn save(&self, file: StateFile, contents: &str) -> Result<(), String> {
        if contents.len() > MAX_STATE_BYTES {
            return Err(format!(
                "{} would be larger than {} MiB",
                file.file_name(),
                MAX_STATE_BYTES / (1024 * 1024)
            ));
        }
        let new_version = match serde_json::from_str::<serde_json::Value>(contents) {
            Ok(value) => version_of(&value),
            Err(e) => return Err(format!("{} is not valid JSON: {e}", file.file_name())),
        };
        let path = self.path(file)?;
        let dir = path
            .parent()
            .ok_or_else(|| "state file has no parent directory".to_string())?;
        let _guard = self.lock.lock().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;

        match std::fs::read(&path) {
            Ok(existing) => match serde_json::from_slice::<serde_json::Value>(&existing) {
                // The file on disk is unusable and this save would replace it.
                Err(_) => copy_aside(&path, &bak_path(&path, None))
                    .map_err(|e| format!("could not back up {}: {e}", path.display()))?,
                Ok(value) => {
                    let on_disk = version_of(&value);
                    if on_disk > new_version {
                        let bak = bak_path(&path, Some(on_disk));
                        // Keep the first copy: it is the newer build's own.
                        if !bak.exists() {
                            copy_aside(&path, &bak).map_err(|e| {
                                format!("could not back up {}: {e}", path.display())
                            })?;
                        }
                    }
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }

        crate::atomic_write::write_atomic(&path, contents.as_bytes())
            .map_err(|e| format!("{}: {e}", path.display()))
    }
}

/// The parsed state file in `dir`, or `None` when it is missing or unusable.
/// Read-only and lock-free: saves are atomic renames, so this always sees a
/// whole file. For Rust's own reads of settings and workspaces (file scope,
/// language server trust, the hook opt-out); it never repairs or backs up.
pub fn read_json(dir: &Path, file: StateFile) -> Option<serde_json::Value> {
    let bytes = std::fs::read(dir.join(file.file_name())).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The top-level `version` number; a file without one (or an array-shaped
/// legacy file) is version 0.
fn version_of(value: &serde_json::Value) -> u64 {
    value.get("version").and_then(|v| v.as_u64()).unwrap_or(0)
}

/// The text as UTF-8 when it is valid JSON, else `None`.
fn parse_state(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    serde_json::from_str::<serde::de::IgnoredAny>(text).ok()?;
    Some(text.to_string())
}

/// `<name>.json.bak`, or `<name>.json.v<N>.bak` for a newer-version copy.
fn bak_path(path: &Path, version: Option<u64>) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    match version {
        None => name.push(".bak"),
        Some(v) => name.push(format!(".v{v}.bak")),
    }
    PathBuf::from(name)
}

fn copy_aside(from: &Path, to: &Path) -> std::io::Result<()> {
    let bytes = std::fs::read(from)?;
    crate::atomic_write::write_atomic(to, &bytes)
}

#[tauri::command(async)]
pub fn state_load(name: StateFile, store: State<'_, StateStore>) -> Result<StateLoad, String> {
    store.load(name)
}

#[tauri::command(async)]
pub fn state_save(
    name: StateFile,
    contents: String,
    store: State<'_, StateStore>,
) -> Result<(), String> {
    store.save(name, &contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store(tmp: &TempDir) -> StateStore {
        StateStore::new(Some(tmp.path().join(".atlas")))
    }

    fn read(tmp: &TempDir, name: &str) -> String {
        std::fs::read_to_string(tmp.path().join(".atlas").join(name)).unwrap()
    }

    #[test]
    fn a_missing_file_loads_as_none_without_recovery() {
        let tmp = TempDir::new().unwrap();
        let loaded = store(&tmp).load(StateFile::Settings).unwrap();
        assert_eq!(
            loaded,
            StateLoad {
                contents: None,
                recovered: false
            }
        );
    }

    #[test]
    fn save_then_load_round_trips_and_creates_the_directory() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        s.save(StateFile::Workspaces, r#"{"version":1,"workspaces":[]}"#)
            .unwrap();
        let loaded = s.load(StateFile::Workspaces).unwrap();
        assert_eq!(
            loaded.contents.as_deref(),
            Some(r#"{"version":1,"workspaces":[]}"#)
        );
        assert!(!loaded.recovered);
    }

    #[test]
    fn a_truncated_file_is_copied_to_bak_and_reported_as_recovered() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        let dir = tmp.path().join(".atlas");
        std::fs::create_dir_all(&dir).unwrap();
        let truncated = r#"{"workspaces":[{"path":"/a","sessions":[{"#;
        std::fs::write(dir.join("workspaces.json"), truncated).unwrap();

        let loaded = s.load(StateFile::Workspaces).unwrap();

        assert_eq!(
            loaded,
            StateLoad {
                contents: None,
                recovered: true
            }
        );
        assert_eq!(read(&tmp, "workspaces.json.bak"), truncated);
        // The original is left in place for the user; only the copy is new.
        assert_eq!(read(&tmp, "workspaces.json"), truncated);
    }

    #[test]
    fn a_newer_bad_file_replaces_an_older_bak() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        let dir = tmp.path().join(".atlas");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json.bak"), "first corruption").unwrap();
        std::fs::write(dir.join("settings.json"), "{ second").unwrap();

        s.load(StateFile::Settings).unwrap();

        assert_eq!(read(&tmp, "settings.json.bak"), "{ second");
    }

    #[test]
    fn saving_over_a_corrupt_file_keeps_a_copy_even_if_load_never_ran() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        let dir = tmp.path().join(".atlas");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("workspaces.json"), r#"{"workspaces":[{"#).unwrap();

        s.save(StateFile::Workspaces, r#"{"version":1}"#).unwrap();

        assert_eq!(read(&tmp, "workspaces.json.bak"), r#"{"workspaces":[{"#);
        assert_eq!(read(&tmp, "workspaces.json"), r#"{"version":1}"#);
    }

    #[test]
    fn a_save_that_is_not_json_is_rejected_and_leaves_the_file_alone() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        s.save(StateFile::Settings, r#"{"version":1}"#).unwrap();

        assert!(s.save(StateFile::Settings, "{ nope").is_err());

        assert_eq!(read(&tmp, "settings.json"), r#"{"version":1}"#);
    }

    #[test]
    fn an_older_build_saving_over_a_newer_file_keeps_the_newer_one_once() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        s.save(StateFile::Settings, r#"{"version":3,"future":true}"#)
            .unwrap();

        s.save(StateFile::Settings, r#"{"version":1}"#).unwrap();
        assert_eq!(
            read(&tmp, "settings.json.v3.bak"),
            r#"{"version":3,"future":true}"#
        );

        // A second downgrade-write must not replace the newer build's copy
        // with this build's own output.
        s.save(StateFile::Settings, r#"{"version":3,"future":false}"#)
            .unwrap();
        s.save(StateFile::Settings, r#"{"version":1,"again":1}"#)
            .unwrap();
        assert_eq!(
            read(&tmp, "settings.json.v3.bak"),
            r#"{"version":3,"future":true}"#
        );
    }

    #[test]
    fn saving_the_same_or_a_higher_version_makes_no_backup() {
        let tmp = TempDir::new().unwrap();
        let s = store(&tmp);
        s.save(StateFile::Settings, r#"{"version":1}"#).unwrap();
        s.save(StateFile::Settings, r#"{"version":1,"a":1}"#)
            .unwrap();
        s.save(StateFile::Settings, r#"{"version":2}"#).unwrap();

        let names: Vec<String> = std::fs::read_dir(tmp.path().join(".atlas"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["settings.json".to_string()]);
    }

    #[test]
    fn overlapping_saves_never_leave_a_torn_file() {
        let tmp = TempDir::new().unwrap();
        let s = std::sync::Arc::new(store(&tmp));
        let big = format!(r#"{{"version":1,"pad":"{}"}}"#, "x".repeat(64 * 1024));
        let small = r#"{"version":1}"#.to_string();

        let handles: Vec<_> = (0..8)
            .map(|i| {
                let s = s.clone();
                let body = if i % 2 == 0 {
                    big.clone()
                } else {
                    small.clone()
                };
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        s.save(StateFile::Settings, &body).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let final_text = read(&tmp, "settings.json");
        assert!(final_text == big || final_text == small);
        assert!(
            !tmp.path().join(".atlas/settings.json.bak").exists(),
            "a torn write would have been treated as corrupt"
        );
    }

    #[test]
    fn read_json_is_none_for_missing_or_unparseable_and_never_writes() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join(".atlas");
        assert!(read_json(&dir, StateFile::Settings).is_none());

        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), "{ nope").unwrap();
        assert!(read_json(&dir, StateFile::Settings).is_none());
        assert!(!dir.join("settings.json.bak").exists());

        std::fs::write(dir.join("settings.json"), r#"{"claudeHook":false}"#).unwrap();
        assert_eq!(
            read_json(&dir, StateFile::Settings).unwrap()["claudeHook"],
            serde_json::Value::Bool(false)
        );
    }

    #[test]
    fn without_a_home_directory_every_operation_errors() {
        let s = StateStore::new(None);
        assert!(s.load(StateFile::Settings).is_err());
        assert!(s.save(StateFile::Settings, "{}").is_err());
    }
}
