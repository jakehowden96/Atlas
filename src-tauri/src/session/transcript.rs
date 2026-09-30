//! Locating the `~/.claude/projects/<slug>/<session-uuid>.jsonl` transcript that
//! belongs to a Claude session Atlas started with `claude --session-id <uuid>`.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::commands::stats::claude_projects_dir;

/// `^[0-9a-fA-F-]{36}$` — the shape `claude --session-id` accepts. Rejects `/`,
/// `\` and `..` by construction, so the value is safe to join onto a path.
pub(crate) fn is_valid_session_uuid(session_uuid: &str) -> bool {
    session_uuid.len() == 36
        && session_uuid
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Glob `<projects_dir>/*/<uuid>.jsonl`, newest first if a session was resumed
/// from another directory and so exists in more than one project.
///
/// Claude Code derives the project subdirectory from a slug of the session's
/// cwd. That algorithm is undocumented, so we scan the project dirs instead of
/// reimplementing it — a wrong slug would silently find nothing.
fn find_transcript_in(projects_dir: &Path, session_uuid: &str) -> Option<PathBuf> {
    if !is_valid_session_uuid(session_uuid) {
        return None;
    }
    let file_name = format!("{}.jsonl", session_uuid);
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for project in std::fs::read_dir(projects_dir).ok()?.flatten() {
        if !project.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let candidate = project.path().join(&file_name);
        let Ok(meta) = std::fs::metadata(&candidate) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if newest.as_ref().is_none_or(|(best, _)| modified > *best) {
            newest = Some((modified, candidate));
        }
    }
    newest.map(|(_, path)| path)
}

/// Locate the transcript for `session_uuid` under `~/.claude/projects/`. Does
/// blocking directory IO; call it off the async runtime.
pub fn find_transcript(session_uuid: &str) -> Option<PathBuf> {
    let projects_dir = claude_projects_dir().ok()?;
    find_transcript_in(&projects_dir, session_uuid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn projects_with(session_uuid: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("-Users-jake-my-project");
        std::fs::create_dir_all(&project).unwrap();
        let transcript = project.join(format!("{}.jsonl", session_uuid));
        std::fs::write(&transcript, "{}\n").unwrap();
        (dir, transcript)
    }

    #[test]
    fn finds_transcript_in_a_project_subdir() {
        let (dir, transcript) = projects_with(UUID);
        assert_eq!(find_transcript_in(dir.path(), UUID), Some(transcript));
    }

    #[test]
    fn returns_none_when_transcript_is_absent() {
        let (dir, _) = projects_with(UUID);
        assert_eq!(
            find_transcript_in(dir.path(), "00000000-0000-4000-8000-000000000000"),
            None
        );
    }

    #[test]
    fn returns_none_when_projects_dir_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(find_transcript_in(&dir.path().join("nope"), UUID), None);
    }

    #[test]
    fn ignores_files_directly_under_projects_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(format!("{}.jsonl", UUID)), "{}\n").unwrap();
        assert_eq!(find_transcript_in(dir.path(), UUID), None);
    }

    #[test]
    fn rejects_session_uuid_with_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let unix_traversal = "../../../etc/passwd-aaaaaaaaaaaaa";
        let windows_traversal = "..\\..\\..\\windows\\system32-aaa";
        assert!(!is_valid_session_uuid(unix_traversal));
        assert!(!is_valid_session_uuid(windows_traversal));
        assert_eq!(find_transcript_in(dir.path(), unix_traversal), None);
        assert_eq!(find_transcript_in(dir.path(), windows_traversal), None);
    }

    #[test]
    fn rejects_session_uuid_with_dot_dot() {
        assert!(!is_valid_session_uuid(
            "550e8400-e29b-41d4-a716-4466554400.."
        ));
    }

    #[test]
    fn rejects_wrong_length_session_uuid() {
        assert!(!is_valid_session_uuid(""));
        assert!(!is_valid_session_uuid(
            "550e8400-e29b-41d4-a716-44665544000"
        ));
        assert!(!is_valid_session_uuid(
            "550e8400-e29b-41d4-a716-4466554400000"
        ));
    }

    #[test]
    fn accepts_a_v4_uuid_in_either_case() {
        assert!(is_valid_session_uuid(UUID));
        assert!(is_valid_session_uuid(&UUID.to_uppercase()));
    }

    /// A session resumed from another directory exists in two projects. Which
    /// one is tailed must not depend on `read_dir` order.
    #[test]
    fn the_newest_copy_wins_when_a_session_exists_in_two_projects() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for project in ["-old-project", "-new-project"] {
            let dir = dir.path().join(project);
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("{UUID}.jsonl"));
            std::fs::write(&path, "{}\n").unwrap();
            paths.push(path);
        }
        let set_modified = |path: &Path, secs: u64| {
            let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
            file.set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(secs))
                .unwrap();
        };
        set_modified(&paths[0], 1_000);
        set_modified(&paths[1], 2_000);
        assert_eq!(find_transcript_in(dir.path(), UUID), Some(paths[1].clone()));

        set_modified(&paths[0], 3_000);
        assert_eq!(find_transcript_in(dir.path(), UUID), Some(paths[0].clone()));
    }
}
