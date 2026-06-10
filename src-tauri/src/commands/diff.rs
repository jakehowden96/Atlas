use super::git::git_cmd;
use std::fs;

pub(crate) struct DiffBundle {
    /// Local working tree changes (Tier 1 only)
    pub local: String,
    /// Best available diff across all tiers (current behavior)
    pub full: String,
}

/// Generate synthetic unified diff output for untracked files.
/// Reads each file's contents and produces diff format identical to what
/// `git diff` would show after `git add`.
///
/// Caps individual files at 100 KB and total output at 1 MB to avoid
/// stalling on large untracked assets (images, data files, build artifacts).
pub(crate) fn generate_untracked_diffs(git_root: &str) -> String {
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
pub(crate) fn discover_diff(git_root: &str) -> DiffBundle {
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
        match git_cmd(git_root, &["diff", "--unified=3", base]) {
            Ok(diff) if !diff.is_empty() => diff,
            Ok(_) => {
                log::debug!("diff against base {base} is empty; falling back to local diff");
                local.clone()
            }
            Err(e) => {
                log::warn!("diff against base {base} failed ({e}); falling back to local diff");
                local.clone()
            }
        }
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

    DiffBundle {
        local: truncate_diff(local),
        full: truncate_diff(full),
    }
}

/// Cap on tracked diff output. Untracked diffs are already capped at
/// generation time, but `git diff` output is unbounded — a huge diff would
/// be buffered, written to panel.json, and shipped to the frontend whole.
const MAX_DIFF_SIZE: usize = 2 * 1024 * 1024; // 2 MB

/// Truncate an oversized diff, cutting at the last file boundary under the
/// cap so the remaining output stays well-formed. Falls back to a plain cut
/// if a single file's diff exceeds the cap on its own.
fn truncate_diff(diff: String) -> String {
    if diff.len() <= MAX_DIFF_SIZE {
        return diff;
    }

    let mut end = MAX_DIFF_SIZE;
    while !diff.is_char_boundary(end) {
        end -= 1;
    }
    if let Some(boundary) = diff[..end].rfind("\ndiff --git ") {
        if boundary > 0 {
            end = boundary + 1; // keep the trailing newline of the previous file
        }
    }

    log::warn!(
        "diff output truncated from {} to {} bytes (cap {})",
        diff.len(),
        end,
        MAX_DIFF_SIZE
    );
    diff[..end].to_string()
}

pub(crate) fn count_diff_stats(raw: &str) -> (u32, u32, u32) {
    let mut files: u32 = 0;
    let mut added: u32 = 0;
    let mut removed: u32 = 0;
    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            files += 1;
        } else if line.starts_with('+') && !line.starts_with("+++") {
            added += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            removed += 1;
        }
    }
    (files, added, removed)
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

    // --- generate_untracked_diffs on non-git dir ---

    #[test]
    fn untracked_diffs_non_git_dir() {
        let result = generate_untracked_diffs("/tmp");
        assert!(result.is_empty());
    }

    // --- truncate_diff ---

    #[test]
    fn truncate_diff_under_cap_unchanged() {
        let diff = "diff --git a/a.rs b/a.rs\n+small\n".to_string();
        assert_eq!(truncate_diff(diff.clone()), diff);
    }

    #[test]
    fn truncate_diff_cuts_at_file_boundary() {
        // First file fits under the cap; second file pushes past it.
        let first = format!("diff --git a/a.rs b/a.rs\n{}", "+x\n".repeat(100));
        let second = format!(
            "diff --git a/b.rs b/b.rs\n+{}\n",
            "y".repeat(MAX_DIFF_SIZE)
        );
        let result = truncate_diff(format!("{first}{second}"));
        assert_eq!(result, first);
    }

    #[test]
    fn truncate_diff_single_huge_file_plain_cut() {
        let diff = format!(
            "diff --git a/a.rs b/a.rs\n+{}\n",
            "x".repeat(MAX_DIFF_SIZE * 2)
        );
        let result = truncate_diff(diff);
        assert_eq!(result.len(), MAX_DIFF_SIZE);
        assert!(result.starts_with("diff --git a/a.rs"));
    }
}
