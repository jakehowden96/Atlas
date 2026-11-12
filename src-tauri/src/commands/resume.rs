use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use ts_rs::TS;

use crate::error::AtlasError;
use crate::session::transcript::is_valid_session_uuid;
use crate::transcript::{jsonl_lines, line_type, user_text};

/// `~/.claude/projects`, resolved through symlinks when it exists. notify's
/// macOS backend reports real paths, so with `~/.claude` symlinked (common with
/// dotfile managers) the watchers would never match a transcript path built
/// from the unresolved name.
pub fn claude_projects_dir() -> Result<PathBuf, AtlasError> {
    let dir = dirs::home_dir()
        .ok_or_else(|| AtlasError::internal("Could not determine home directory"))?
        .join(".claude")
        .join("projects");
    Ok(crate::transcript::resolve_symlinks(dir))
}

/// One prior conversation the New Session modal can hand to `claude --resume`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export)]
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

/// Lines read from a transcript's head to find its `cwd`.
const CWD_PEEK_LINES: usize = 50;

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

/// A "user" line can be genuinely typed by the human, or injected by a skill/hook/
/// background-task notification. Only the former counts as "a message from you".
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

/// Direct-child `*.jsonl` files of each project directory (never subagents).
fn session_files(projects_dir: &Path) -> Vec<PathBuf> {
    let Ok(projects) = std::fs::read_dir(projects_dir) else {
        return Vec::new();
    };
    projects
        .flatten()
        .filter(|p| p.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|p| std::fs::read_dir(p.path()).ok())
        .flat_map(|entries| entries.flatten())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .collect()
}

/// The first `cwd` in a transcript's head. Bounded so a scan of unrelated
/// workspaces costs a few lines per file, not a full read.
fn peek_cwd(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    jsonl_lines(BufReader::new(file))
        .take(CWD_PEEK_LINES)
        .filter_map(|l| serde_json::from_str::<Value>(&l).ok())
        .find_map(|o| o.get("cwd").and_then(|v| v.as_str()).map(String::from))
}

/// Read one transcript fully for the fields the Resume list shows.
fn read_session(path: &Path) -> Option<ResumableSession> {
    let session_id = path.file_stem()?.to_str()?.to_string();
    let file = std::fs::File::open(path).ok()?;
    let mut s = ResumableSession {
        session_id,
        ..Default::default()
    };
    for line in jsonl_lines(BufReader::new(file)) {
        let Ok(obj) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(ts) = obj.get("timestamp").and_then(|v| v.as_str()) {
            s.last_timestamp = Some(ts.to_string());
        }
        if let Some(b) = obj.get("gitBranch").and_then(|v| v.as_str()) {
            s.git_branch = Some(b.to_string());
        }
        match line_type(&obj) {
            "user" => {
                let is_meta = obj.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
                if let Some(t) = user_text(&obj) {
                    if !is_meta && is_human_authored(&obj, &t) {
                        s.user_messages += 1;
                    }
                }
            }
            "ai-title" => {
                if let Some(t) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                    s.title = Some(t.to_string());
                }
            }
            _ => {}
        }
    }
    Some(s)
}

/// The sessions of one workspace under `projects_dir`, newest first, capped.
/// Only the newest `RESUMABLE_LIMIT` transcripts (by file mtime) are read in full.
fn resumable_in(projects_dir: &Path, cwd: &str) -> Vec<ResumableSession> {
    let want = normalize_path(cwd);
    let mut matched: Vec<(SystemTime, PathBuf)> = session_files(projects_dir)
        .into_iter()
        // The id is typed into the user's shell as `--resume <id>`, so only the
        // uuid shape Claude Code writes is offered: a transcript named
        // `x;touch pwned` must not appear as a session.
        .filter(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(is_valid_session_uuid)
        })
        .filter(|p| peek_cwd(p).is_some_and(|c| normalize_path(&c) == want))
        .map(|p| {
            let m = std::fs::metadata(&p)
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (m, p)
        })
        .collect();
    matched.sort_by(|a, b| b.0.cmp(&a.0));
    let mut found: Vec<ResumableSession> = matched
        .into_iter()
        .take(RESUMABLE_LIMIT)
        .filter_map(|(_, p)| read_session(&p))
        .collect();
    found.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
    found
}

/// Prior conversations in `cwd`, for the New Session modal's Resume list.
///
/// Read straight from the transcripts. `claude --resume` itself is never
/// shelled out to: it opens an interactive picker and prints nothing
/// machine-readable.
#[tauri::command]
pub async fn list_resumable_sessions(cwd: String) -> Result<Vec<ResumableSession>, AtlasError> {
    tokio::task::spawn_blocking(move || Ok(resumable_in(&claude_projects_dir()?, &cwd))).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    const SID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn write(dir: &Path, project: &str, id: &str, cwd: &str, ts: &str, msgs: u32) {
        let d = dir.join(project);
        std::fs::create_dir_all(&d).unwrap();
        let mut body = String::new();
        for i in 0..msgs {
            body.push_str(&format!(
                r#"{{"type":"user","uuid":"u{i}","timestamp":"{ts}","cwd":{cwd:?},"gitBranch":"main","message":{{"role":"user","content":"hi"}}}}"#
            ));
            body.push('\n');
        }
        body.push_str(r#"{"type":"ai-title","aiTitle":"A title"}"#);
        body.push('\n');
        std::fs::write(d.join(format!("{id}.jsonl")), body).unwrap();
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

    /// A transcript file name is untrusted input to a shell command line.
    #[test]
    fn resumable_offers_only_uuid_shaped_ids() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "p",
            SID,
            "/repo/atlas",
            "2026-01-01T00:00:00Z",
            1,
        );
        write(
            dir.path(),
            "p",
            "x;touch pwned",
            "/repo/atlas",
            "2026-01-02T00:00:00Z",
            1,
        );
        write(
            dir.path(),
            "p",
            "--dangerously-skip",
            "/repo/atlas",
            "2026-01-03T00:00:00Z",
            1,
        );
        let found = resumable_in(dir.path(), "/repo/atlas");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, SID);
    }

    #[test]
    fn resumable_matches_a_workspace_whose_separators_differ_from_the_transcript() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "p",
            SID,
            r"C:\repo\atlas",
            "2026-01-01T00:00:00Z",
            1,
        );
        let found = resumable_in(dir.path(), "C:/repo/atlas/");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, SID);
    }

    #[test]
    fn resumable_is_filtered_by_cwd_newest_first_and_capped() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..30 {
            write(
                dir.path(),
                "p",
                &format!("{i:08x}-0000-4000-8000-000000000000"),
                "/repo/atlas",
                &format!("2026-01-{:02}T00:00:00Z", i + 1),
                2,
            );
        }
        write(
            dir.path(),
            "q",
            "ffffffff-0000-4000-8000-000000000000",
            "/repo/elsewhere",
            "2026-12-31T00:00:00Z",
            1,
        );
        let found = resumable_in(dir.path(), "/repo/atlas");
        assert_eq!(found.len(), RESUMABLE_LIMIT, "capped at 25");
        assert_eq!(found[0].session_id, "0000001d-0000-4000-8000-000000000000");
        assert!(found
            .iter()
            .all(|r| r.session_id != "ffffffff-0000-4000-8000-000000000000"));
        assert_eq!(found[0].user_messages, 2);
        assert_eq!(found[0].git_branch.as_deref(), Some("main"));
        assert_eq!(found[0].title.as_deref(), Some("A title"));
    }

    #[test]
    fn resumable_is_empty_for_a_workspace_with_no_history() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "p",
            SID,
            "/repo/atlas",
            "2026-01-01T00:00:00Z",
            1,
        );
        assert!(resumable_in(dir.path(), "/repo/brand-new").is_empty());
    }

    #[test]
    fn resumable_ignores_transcripts_with_no_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().join("p");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(format!("{SID}.jsonl")), "{\"type\":\"user\"}\n").unwrap();
        assert!(resumable_in(dir.path(), "/repo/atlas").is_empty());
    }
}
