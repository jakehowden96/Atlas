/** What a size cap left out of a diff. */
export interface Truncation {
  /** Files present in the shown text (the last may be cut part-way). */
  shown_files: number;
  /** Files changed in all, as far as git could be asked. */
  total_files: number;
  shown_bytes: number;
}

export interface ProjectDiff {
  name: string;
  raw: string;
  files_changed: number;
  lines_added: number;
  lines_removed: number;
  truncated?: Truncation;
}

export interface DiffData {
  /** A single repo's diff. Empty when `projects` is set — the per-repo diffs
   *  live only there. */
  raw: string;
  /** Files changed, counting files a cap left out of `raw`/`projects`. */
  files_changed: number;
  /** Lines added and removed in the text that is present. */
  lines_added: number;
  lines_removed: number;
  /** Identity of the diff content: equal fingerprints mean nothing new to parse. */
  fingerprint: string;
  truncated?: Truncation;
  projects?: ProjectDiff[];
  local_raw?: string;
  local_truncated?: Truncation;
}

export interface PanelData {
  version: number;
  timestamp: string;
  cwd: string;
  /** `null` when the tree is clean or the directory holds no repo. */
  diff: DiffData | null;
  /** Why there is nothing to show when it is not simply a clean tree. */
  issue?: PanelIssue;
}

/** No `git` on PATH, so no directory can be diffed. */
export type PanelIssue = "git_not_found";

export interface GitStatus {
  has_unstaged: boolean;
  has_staged: boolean;
}
