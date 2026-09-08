/** Mirrors `src-tauri/src/commands/files.rs`. */

/**
 * One node of the workspace document tree. Directories are included so the tree
 * can show empty folders. Already sorted directories-first then
 * case-insensitively by name — do not re-sort.
 */
export interface DocEntry {
  /** Forward-slash path relative to the workspace root — the tree key. */
  rel_path: string;
  name: string;
  is_dir: boolean;
  size: number;
  /** RFC3339, or null when the platform does not report mtime. */
  modified: string | null;
}

/**
 * A file in `~/.claude/plans`. `name` is the file stem — a slugified cwd plus a
 * random suffix (`c-users-me-github-atlas-atl-curried-thacker`), not a session
 * id, so matching a plan to a workspace happens here rather than in Rust.
 */
export interface PlanEntry {
  /** Absolute. */
  path: string;
  name: string;
  modified: string | null;
}

export interface DocsChangedEvent {
  workspacePath: string;
  relPath: string;
}
