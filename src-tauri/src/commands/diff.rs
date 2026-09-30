use super::git::{git_cmd, git_raw, git_raw_capped};
use crate::panel::types::Truncation;
use std::fs;
use std::io::Read;

/// A diff as it will be shown: possibly cut to the size cap, with the account
/// of what was left out.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct DiffPart {
    pub text: String,
    pub truncated: Option<Truncation>,
}

pub(crate) struct DiffBundle {
    /// Local working tree changes (Tier 1 only)
    pub local: DiffPart,
    /// Best available diff across all tiers (current behavior)
    pub full: DiffPart,
}

/// Synthetic diffs of untracked files, and how many were not examined because
/// a cap was hit first.
pub(crate) struct UntrackedDiffs {
    pub text: String,
    pub omitted: u32,
}

/// Generate synthetic unified diff output for untracked files.
/// Reads each file's contents and produces diff format identical to what
/// `git diff` would show after `git add`.
///
/// Caps individual files at 100 KB, the number of files examined, and total
/// output at 1 MB to avoid stalling on large untracked assets (images, data
/// files, build artifacts). Only regular files are read: a symlink would leak
/// whatever it points at (`~/.ssh/id_rsa`) into the diff, and a FIFO or
/// `/dev/zero` would hang the read.
pub(crate) fn generate_untracked_diffs(git_root: &str) -> UntrackedDiffs {
    const MAX_FILE_SIZE: u64 = 100 * 1024; // 100 KB per file
    const MAX_TOTAL_SIZE: usize = 1024 * 1024; // 1 MB total output
    const MAX_FILES_EXAMINED: usize = 1000;

    // `-z`: paths come back NUL-separated and verbatim. Without it git
    // C-quotes anything non-ASCII, and those files silently vanish.
    let file_list = match git_raw(
        git_root,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    ) {
        Ok(list) if !list.is_empty() => list,
        _ => {
            return UntrackedDiffs {
                text: String::new(),
                omitted: 0,
            }
        }
    };

    let root = std::path::Path::new(git_root);
    let mut result = String::new();
    let paths: Vec<&str> = file_list.split('\0').filter(|p| !p.is_empty()).collect();
    let mut examined = 0;

    for rel_path in &paths {
        if examined == MAX_FILES_EXAMINED {
            break;
        }
        examined += 1;
        let abs_path = root.join(rel_path);

        let Ok(link_meta) = fs::symlink_metadata(&abs_path) else {
            continue;
        };
        if !link_meta.is_file() {
            continue;
        }
        let Ok(file) = fs::File::open(&abs_path) else {
            continue;
        };
        // Bound the read rather than trusting the stat: the size can change
        // between the two.
        let mut content = Vec::new();
        if file
            .take(MAX_FILE_SIZE + 1)
            .read_to_end(&mut content)
            .is_err()
            || content.len() as u64 > MAX_FILE_SIZE
        {
            continue;
        }

        // Skip binary files (null byte in first 8KB)
        let check_len = content.len().min(8192);
        if content[..check_len].contains(&0) {
            continue;
        }

        let text = match String::from_utf8(content) {
            Ok(t) => t,
            Err(_) => continue,
        };

        result.push_str(&format!("diff --git a/{path} b/{path}\n", path = rel_path));
        result.push_str("new file mode 100644\n");
        // Like git, an empty file gets no ---/+++/hunk at all.
        if !text.is_empty() {
            let lines: Vec<&str> = text.lines().collect();
            result.push_str("--- /dev/null\n");
            result.push_str(&format!("+++ b/{}\n", rel_path));
            result.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
            for line in &lines {
                result.push('+');
                result.push_str(line);
                result.push('\n');
            }
        }

        if result.len() > MAX_TOTAL_SIZE {
            break;
        }
    }

    UntrackedDiffs {
        text: result,
        omitted: (paths.len() - examined) as u32,
    }
}

/// Cap on one repo's diff. Untracked diffs are already capped at generation
/// time, but `git diff` output is unbounded — a huge diff would be buffered,
/// written to panel.json, and shipped to the frontend whole.
const MAX_DIFF_SIZE: usize = 2 * 1024 * 1024; // 2 MB

/// Cap on the diffs of every repo in one multi-repo panel together.
pub(crate) const MAX_PANEL_DIFF_SIZE: usize = 4 * 1024 * 1024; // 4 MB

/// Cap on the `--numstat` read that counts the files behind an oversized diff.
const MAX_NUMSTAT_SIZE: usize = 4 * 1024 * 1024;

/// Tracked changes as git printed them, read only up to the cap plus one byte
/// so `truncate_diff` still sees that it overflowed.
struct TrackedDiff {
    text: String,
    /// How many files git reports as changed. Only looked up when `text` is
    /// over the cap, since only then does it differ from what `text` holds.
    total_files: Option<u32>,
}

/// `git diff` in a fixed, machine-readable shape. The user's global config
/// (`diff.external`, `color.ui=always`, `diff.noprefix`, textconv drivers)
/// would otherwise change what the parser downstream sees, and repo-level
/// external/textconv drivers would execute commands from an untrusted
/// checkout.
fn git_diff_args<'a>(extra: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];
    args.extend_from_slice(extra);
    args
}

fn git_diff(git_root: &str, extra: &[&str]) -> Result<TrackedDiff, String> {
    let mut patch_extra = vec!["--unified=3"];
    patch_extra.extend_from_slice(extra);
    let args = git_diff_args(&patch_extra);
    let (text, _) = git_raw_capped(git_root, &args, MAX_DIFF_SIZE + 1)?;
    let total_files = if text.len() > MAX_DIFF_SIZE {
        // No `--unified`: any context option turns the patch back on.
        let mut numstat_extra = vec!["--numstat"];
        numstat_extra.extend_from_slice(extra);
        let numstat_args = git_diff_args(&numstat_extra);
        git_raw_capped(git_root, &numstat_args, MAX_NUMSTAT_SIZE)
            .ok()
            .map(|(out, _)| out.lines().filter(|l| !l.is_empty()).count() as u32)
    } else {
        None
    };
    Ok(TrackedDiff { text, total_files })
}

/// Tracked changes plus, when asked, the untracked files, cut to the cap with
/// the account of what was left out.
fn assemble(tracked: &TrackedDiff, untracked: Option<&UntrackedDiffs>) -> DiffPart {
    let mut text = tracked.text.clone();
    let mut omitted = 0;
    let mut untracked_files = 0;
    if let Some(untracked) = untracked.filter(|u| !u.text.is_empty() || u.omitted > 0) {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&untracked.text);
        omitted = untracked.omitted;
        untracked_files = count_diff_stats(&untracked.text).0;
    }
    let tracked_files = tracked
        .total_files
        .unwrap_or_else(|| count_diff_stats(&tracked.text).0);
    let total_files = tracked_files + untracked_files + omitted;

    let (text, cut) = truncate_diff(text, MAX_DIFF_SIZE);
    let truncated = (cut || omitted > 0).then(|| truncation_of(&text, total_files));
    DiffPart { text, truncated }
}

/// 3-tier diff discovery matching sift's extractBestDiff.
/// Returns both local-only changes and the full (best-tier) diff.
pub(crate) fn discover_diff(git_root: &str) -> DiffBundle {
    let untracked = generate_untracked_diffs(git_root);

    // Tier 1: Working tree changes (staged + unstaged vs HEAD). An empty
    // result is final: with a HEAD, the unstaged and staged-only queries
    // below can only be empty too, so they run only when HEAD is missing.
    let local_tracked = match git_diff(git_root, &["HEAD", "--"]) {
        Ok(diff) => diff,
        Err(_) => {
            // Tier 1b: HEAD doesn't exist (initial commit) — unstaged changes
            let mut diff = git_diff(git_root, &["--"]).unwrap_or_else(|_| TrackedDiff {
                text: String::new(),
                total_files: None,
            });
            // Tier 1c: Staged-only changes
            if diff.text.is_empty() {
                if let Ok(staged) = git_diff(git_root, &["--cached", "--"]) {
                    diff = staged;
                }
            }
            diff
        }
    };
    let local = assemble(&local_tracked, Some(&untracked));

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

    // Build `full` diff: working tree vs upstream/base (includes both local and
    // committed changes). A base-ref diff carries no untracked files, so they
    // are appended; the fallback to `local` already has them.
    let full = match &base_ref {
        Some(base) => match git_diff(git_root, &[base, "--"]) {
            Ok(diff) if !diff.text.is_empty() => assemble(&diff, Some(&untracked)),
            Ok(_) => {
                log::debug!("diff against base {base} is empty; falling back to local diff");
                local.clone()
            }
            Err(e) => {
                log::warn!("diff against base {base} failed ({e}); falling back to local diff");
                local.clone()
            }
        },
        None => local.clone(),
    };

    DiffBundle { local, full }
}

/// The account for `shown`, cut from a diff that touches `total_files`.
fn truncation_of(shown: &str, total_files: u32) -> Truncation {
    Truncation {
        shown_files: count_diff_stats(shown).0,
        total_files,
        shown_bytes: shown.len() as u64,
    }
}

/// Cut `diff` to at most `cap` bytes, at the last file boundary under the cap
/// so the remaining output stays well-formed. Falls back to a plain cut if a
/// single file's diff exceeds the cap on its own. The flag says whether
/// anything was cut.
fn truncate_diff(diff: String, cap: usize) -> (String, bool) {
    if diff.len() <= cap {
        return (diff, false);
    }

    let mut end = cap;
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
        cap
    );
    (diff[..end].to_string(), true)
}

/// Fit a repo's diff into what is left of a multi-repo panel's budget, keeping
/// the account of what the cut removed (or what an earlier cut already had).
pub(crate) fn fit_to_budget(part: DiffPart, budget: usize) -> DiffPart {
    if part.text.len() <= budget {
        return part;
    }
    let total_files = part
        .truncated
        .map_or_else(|| count_diff_stats(&part.text).0, |t| t.total_files);
    let (text, _) = truncate_diff(part.text, budget);
    let truncated = Some(truncation_of(&text, total_files));
    DiffPart { text, truncated }
}

/// Count files, added lines and removed lines in a unified diff.
///
/// Lines are classified by position, not by prefix: between a `diff --git`
/// line and its first `@@` are headers (`--- a/x`, `+++ b/x`, modes, index),
/// and after it every `+`/`-` line is content. A prefix test would drop a
/// removed SQL comment (`-- x` diffs as `--- x`) or an added `++i;`.
pub(crate) fn count_diff_stats(raw: &str) -> (u32, u32, u32) {
    let mut files: u32 = 0;
    let mut added: u32 = 0;
    let mut removed: u32 = 0;
    let mut in_hunk = false;
    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            files += 1;
            in_hunk = false;
        } else if line.starts_with("@@") {
            in_hunk = true;
        } else if in_hunk {
            if line.starts_with('+') {
                added += 1;
            } else if line.starts_with('-') {
                removed += 1;
            }
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

    #[test]
    fn count_diff_stats_counts_content_that_looks_like_a_marker() {
        // Removing `-- drop me` and adding `++i;` diff as `--- drop me` and
        // `+++i;`; they are hunk content, not file headers.
        let diff = "\
diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,2 +1,2 @@
--- drop me
+++i;
 keep";
        assert_eq!(count_diff_stats(diff), (1, 1, 1));
    }

    #[test]
    fn count_diff_stats_ignores_headers_without_hunks() {
        let diff = "\
diff --git a/empty.py b/empty.py
new file mode 100644
diff --git a/old b/new
similarity index 100%
rename from old
rename to new";
        assert_eq!(count_diff_stats(diff), (2, 0, 0));
    }

    // --- against real repos ---

    use super::super::git::test_support::{commit_all, git, init_repo};

    #[test]
    fn untracked_diffs_non_git_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(generate_untracked_diffs(dir.path().to_str().unwrap())
            .text
            .is_empty());
    }

    #[test]
    fn untracked_diffs_keep_non_ascii_names() {
        let repo = init_repo();
        std::fs::write(repo.path().join("café.txt"), "hello\n").unwrap();

        let diff = generate_untracked_diffs(repo.path().to_str().unwrap()).text;
        assert!(diff.contains("diff --git a/café.txt b/café.txt"), "{diff}");
        assert!(diff.contains("+hello\n"));
    }

    #[test]
    fn untracked_empty_file_has_no_hunk() {
        let repo = init_repo();
        std::fs::write(repo.path().join("__init__.py"), "").unwrap();

        let diff = generate_untracked_diffs(repo.path().to_str().unwrap()).text;
        assert!(diff.contains("diff --git a/__init__.py b/__init__.py"));
        assert!(!diff.contains("@@"), "{diff}");
        assert_eq!(count_diff_stats(&diff), (1, 0, 0));
    }

    #[cfg(unix)]
    #[test]
    fn untracked_symlinks_are_never_read() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), "TOP-SECRET\n").unwrap();
        let repo = init_repo();
        std::os::unix::fs::symlink(outside.path().join("secret"), repo.path().join("leak.txt"))
            .unwrap();
        // Reads forever if followed.
        std::os::unix::fs::symlink("/dev/zero", repo.path().join("zero")).unwrap();
        std::fs::write(repo.path().join("real.txt"), "real\n").unwrap();

        let diff = generate_untracked_diffs(repo.path().to_str().unwrap()).text;
        assert!(!diff.contains("TOP-SECRET"));
        assert!(!diff.contains("leak.txt"));
        assert!(diff.contains("+real\n"));
    }

    #[test]
    fn discover_diff_is_unified_whatever_the_git_config_says() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        // What a user's global config might say; repo-local here so the test
        // does not depend on the machine's own.
        git(dir, &["config", "diff.external", "false"]);
        git(dir, &["config", "color.ui", "always"]);
        git(dir, &["config", "diff.noprefix", "true"]);
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();

        let bundle = discover_diff(dir.to_str().unwrap());
        assert!(bundle
            .local
            .text
            .starts_with("diff --git a/a.txt b/a.txt\n"));
        assert!(!bundle.local.text.contains('\x1b'));
        assert_eq!(count_diff_stats(&bundle.local.text), (1, 1, 1));
    }

    #[test]
    fn discover_diff_keeps_a_trailing_blank_context_line() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "one\n\n").unwrap();
        commit_all(dir, "init");
        std::fs::write(dir.join("a.txt"), "two\n\n").unwrap();

        let bundle = discover_diff(dir.to_str().unwrap());
        // The hunk header promises 2 old / 2 new lines; trimming the final
        // ` \n` context line would leave it one short.
        assert!(
            bundle.local.text.ends_with("\n \n"),
            "{:?}",
            bundle.local.text
        );
    }

    #[test]
    fn discover_diff_on_a_clean_repo_is_empty() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");

        let bundle = discover_diff(dir.to_str().unwrap());
        assert!(bundle.local.text.is_empty());
        assert!(bundle.full.text.is_empty());
    }

    #[test]
    fn untracked_files_appear_once_when_only_untracked_files_changed() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        std::fs::write(dir.join("new.txt"), "new\n").unwrap();

        let bundle = discover_diff(dir.to_str().unwrap());
        assert_eq!(
            count_diff_stats(&bundle.full.text).0,
            1,
            "{}",
            bundle.full.text
        );
    }

    #[test]
    fn discover_diff_before_the_first_commit_shows_staged_files() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(dir, &["add", "a.txt"]);

        let bundle = discover_diff(dir.to_str().unwrap());
        assert_eq!(count_diff_stats(&bundle.local.text), (1, 1, 0));
    }

    // --- truncation ---

    #[test]
    fn truncate_diff_under_cap_unchanged() {
        let diff = "diff --git a/a.rs b/a.rs\n+small\n".to_string();
        assert_eq!(truncate_diff(diff.clone(), MAX_DIFF_SIZE), (diff, false));
    }

    #[test]
    fn truncate_diff_cuts_at_file_boundary() {
        // First file fits under the cap; second file pushes past it.
        let first = format!("diff --git a/a.rs b/a.rs\n{}", "+x\n".repeat(100));
        let second = format!("diff --git a/b.rs b/b.rs\n+{}\n", "y".repeat(MAX_DIFF_SIZE));
        let (result, cut) = truncate_diff(format!("{first}{second}"), MAX_DIFF_SIZE);
        assert!(cut);
        assert_eq!(result, first);
    }

    #[test]
    fn truncate_diff_single_huge_file_plain_cut() {
        let diff = format!(
            "diff --git a/a.rs b/a.rs\n+{}\n",
            "x".repeat(MAX_DIFF_SIZE * 2)
        );
        let (result, cut) = truncate_diff(diff, MAX_DIFF_SIZE);
        assert!(cut);
        assert_eq!(result.len(), MAX_DIFF_SIZE);
        assert!(result.starts_with("diff --git a/a.rs"));
    }

    #[test]
    fn an_oversized_diff_says_how_much_it_left_out() {
        let repo = init_repo();
        let dir = repo.path();
        for name in ["a.txt", "b.txt", "c.txt"] {
            std::fs::write(dir.join(name), "old\n".repeat(200_000)).unwrap();
        }
        commit_all(dir, "init");
        for name in ["a.txt", "b.txt", "c.txt"] {
            std::fs::write(dir.join(name), "new\n".repeat(200_000)).unwrap();
        }

        let bundle = discover_diff(dir.to_str().unwrap());
        let truncated = bundle.full.truncated.expect("diff is over the cap");
        assert_eq!(truncated.total_files, 3);
        assert!(truncated.shown_files < 3, "{truncated:?}");
        assert!(bundle.full.text.len() <= MAX_DIFF_SIZE);
        assert_eq!(truncated.shown_bytes as usize, bundle.full.text.len());
        assert_eq!(truncated.shown_files, count_diff_stats(&bundle.full.text).0);
    }

    #[test]
    fn a_diff_under_the_cap_is_not_marked_truncated() {
        let repo = init_repo();
        let dir = repo.path();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(dir, "init");
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();

        let bundle = discover_diff(dir.to_str().unwrap());
        assert_eq!(bundle.full.truncated, None);
        assert_eq!(bundle.local.truncated, None);
    }

    #[test]
    fn untracked_files_left_unexamined_are_counted_as_omitted() {
        let repo = init_repo();
        let dir = repo.path();
        // 1000 examined at most; each file is small, so only the file cap bites.
        for i in 0..1005 {
            std::fs::write(dir.join(format!("f{i:04}.txt")), "x\n").unwrap();
        }

        let untracked = generate_untracked_diffs(dir.to_str().unwrap());
        assert_eq!(untracked.omitted, 5);
        assert_eq!(count_diff_stats(&untracked.text).0, 1000);
    }

    #[test]
    fn fit_to_budget_keeps_the_earlier_total_and_cuts_the_text() {
        let first = format!("diff --git a/a.rs b/a.rs\n{}", "+x\n".repeat(100));
        let second = format!("diff --git a/b.rs b/b.rs\n{}", "+y\n".repeat(100));
        let part = DiffPart {
            text: format!("{first}{second}"),
            truncated: None,
        };

        let fitted = fit_to_budget(part, first.len() + 20);
        assert_eq!(fitted.text, first);
        let truncated = fitted.truncated.unwrap();
        assert_eq!((truncated.shown_files, truncated.total_files), (1, 2));

        let empty = fit_to_budget(fitted, 0);
        assert_eq!(empty.text, "");
        // Still 2 files changed, as the first cut already said.
        assert_eq!(empty.truncated.unwrap().total_files, 2);
    }
}
