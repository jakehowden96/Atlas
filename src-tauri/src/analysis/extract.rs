use crate::analysis::patterns::{self, DefinitionKind};
use regex::Regex;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

#[derive(Debug, Clone)]
pub struct Definition {
    pub name: String,
    pub kind: DefinitionKind,
    pub line: u32,
    pub changed: bool,
}

#[derive(Debug, Clone)]
pub struct Import {
    pub source: String,
    pub names: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct FileAnalysis {
    pub path: String,
    pub language: String,
    pub definitions: Vec<Definition>,
    pub imports: Vec<Import>,
}

#[derive(Debug, Clone)]
pub struct AnalysisContext {
    pub files: Vec<FileAnalysis>,
}

/// Represents a range of changed lines in the new (post-change) file.
struct HunkRange {
    start: u32,
    count: u32,
}

static DIFF_FILE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^diff --git a/.+ b/(.+)$").unwrap()
});

static HUNK_HEADER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@").unwrap()
});

/// Parse a unified diff to extract changed file paths and their changed line ranges.
fn parse_diff_files(diff: &str) -> Vec<(String, Vec<HunkRange>)> {
    let mut files: Vec<(String, Vec<HunkRange>)> = Vec::new();

    for line in diff.lines() {
        if let Some(cap) = DIFF_FILE_RE.captures(line) {
            files.push((cap[1].to_string(), Vec::new()));
        } else if let Some(cap) = HUNK_HEADER_RE.captures(line) {
            if let Some(current) = files.last_mut() {
                let start: u32 = cap[1].parse().unwrap_or(0);
                let count: u32 = cap.get(2).map_or(1, |m| m.as_str().parse().unwrap_or(1));
                current.1.push(HunkRange { start, count });
            }
        }
    }

    files
}

/// Check if a given line number falls within any of the changed hunk ranges.
fn is_in_changed_range(line: u32, hunks: &[HunkRange]) -> bool {
    hunks.iter().any(|h| line >= h.start && line < h.start + h.count)
}

/// Analyze a single file: read source, extract definitions and imports.
fn analyze_file(
    git_root: &str,
    rel_path: &str,
    language: &str,
    hunks: &[HunkRange],
) -> Option<FileAnalysis> {
    let abs_path = Path::new(git_root).join(rel_path);
    let source = fs::read_to_string(&abs_path).ok()?;

    let lang_patterns = patterns::get_patterns(language)?;

    let mut definitions = Vec::new();
    let mut seen_defs = HashSet::new();
    let mut imports = Vec::new();

    for (line_idx, line_text) in source.lines().enumerate() {
        let line_num = (line_idx + 1) as u32;

        for pat in &lang_patterns.definitions {
            if let Some(cap) = pat.regex.captures(line_text) {
                if let Some(name_match) = cap.get(pat.name_group) {
                    let name = name_match.as_str().to_string();
                    let key = format!("{}::{}", pat.kind, name);
                    if seen_defs.insert(key) {
                        definitions.push(Definition {
                            name,
                            kind: pat.kind.clone(),
                            line: line_num,
                            changed: is_in_changed_range(line_num, hunks),
                        });
                    }
                }
            }
        }

        for pat in &lang_patterns.imports {
            if let Some(cap) = pat.regex.captures(line_text) {
                let source_str = cap[pat.source_group].trim().to_string();
                let names = if let Some(names_group) = pat.names_group {
                    cap.get(names_group)
                        .map(|m| {
                            m.as_str()
                                .split(',')
                                .map(|s| s.trim().trim_start_matches("type ").to_string())
                                .filter(|s| !s.is_empty())
                                .collect()
                        })
                        .unwrap_or_default()
                } else {
                    Vec::new()
                };
                imports.push(Import {
                    source: source_str,
                    names,
                });
            }
        }
    }

    Some(FileAnalysis {
        path: rel_path.to_string(),
        language: language.to_string(),
        definitions,
        imports,
    })
}

/// Analyze all changed files in a diff. Returns structured context.
pub fn analyze_changed_files(git_root: &str, diff: &str) -> AnalysisContext {
    let diff_files = parse_diff_files(diff);
    let mut files = Vec::new();

    for (path, hunks) in &diff_files {
        if let Some(language) = patterns::detect_language(path) {
            if let Some(analysis) = analyze_file(git_root, path, language, hunks) {
                // Only include files that have definitions or imports
                if !analysis.definitions.is_empty() || !analysis.imports.is_empty() {
                    files.push(analysis);
                }
            }
        }
    }

    AnalysisContext { files }
}

/// Format the analysis context as a human-readable string for the Claude prompt.
pub fn format_context(ctx: &AnalysisContext) -> String {
    if ctx.files.is_empty() {
        return String::new();
    }

    let mut out = String::from("## Code Context (from static analysis)\n\nFiles changed:\n");

    for file in &ctx.files {
        out.push_str(&format!("- {} ({})\n", file.path, file.language));

        if !file.definitions.is_empty() {
            out.push_str("  Definitions:\n");
            for def in &file.definitions {
                let changed_tag = if def.changed { " [CHANGED]" } else { "" };
                out.push_str(&format!(
                    "    * {} {}{} (line {})\n",
                    def.kind, def.name, changed_tag, def.line
                ));
            }
        }

        if !file.imports.is_empty() {
            out.push_str("  Imports:\n");
            for imp in &file.imports {
                if imp.names.is_empty() {
                    out.push_str(&format!("    * {}\n", imp.source));
                } else {
                    out.push_str(&format!(
                        "    * {} from {}\n",
                        imp.names.join(", "),
                        imp.source
                    ));
                }
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_diff_extracts_files_and_hunks() {
        let diff = r#"diff --git a/src/lib.rs b/src/lib.rs
index abc..def 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,5 +10,8 @@ fn main() {
+    new_line();
@@ -30,3 +33,4 @@ fn helper() {
+    another_line();
diff --git a/src/util.rs b/src/util.rs
@@ -1,5 +1,6 @@
+use log;
"#;
        let files = parse_diff_files(diff);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].0, "src/lib.rs");
        assert_eq!(files[0].1.len(), 2);
        assert_eq!(files[0].1[0].start, 10);
        assert_eq!(files[0].1[0].count, 8);
        assert_eq!(files[0].1[1].start, 33);
        assert_eq!(files[1].0, "src/util.rs");
        assert_eq!(files[1].1.len(), 1);
    }

    #[test]
    fn is_in_changed_range_works() {
        let hunks = vec![HunkRange { start: 10, count: 5 }];
        assert!(is_in_changed_range(10, &hunks));
        assert!(is_in_changed_range(14, &hunks));
        assert!(!is_in_changed_range(9, &hunks));
        assert!(!is_in_changed_range(15, &hunks));
    }

    #[test]
    fn format_context_empty() {
        let ctx = AnalysisContext { files: vec![] };
        assert!(format_context(&ctx).is_empty());
    }

    #[test]
    fn format_context_with_data() {
        let ctx = AnalysisContext {
            files: vec![FileAnalysis {
                path: "src/main.rs".to_string(),
                language: "rust".to_string(),
                definitions: vec![Definition {
                    name: "main".to_string(),
                    kind: DefinitionKind::Function,
                    line: 1,
                    changed: true,
                }],
                imports: vec![Import {
                    source: "std::io".to_string(),
                    names: vec![],
                }],
            }],
        };
        let out = format_context(&ctx);
        assert!(out.contains("src/main.rs (rust)"));
        assert!(out.contains("function main [CHANGED]"));
        assert!(out.contains("std::io"));
    }
}
