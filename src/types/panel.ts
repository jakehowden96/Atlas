export interface ProjectDiff {
  name: string;
  raw: string;
  files_changed: number;
  lines_added: number;
  lines_removed: number;
}

export interface DiffData {
  raw: string;
  files_changed: number;
  lines_added: number;
  lines_removed: number;
  projects?: ProjectDiff[];
  local_raw?: string;
  local_files_changed?: number;
  local_lines_added?: number;
  local_lines_removed?: number;
}

export interface PanelData {
  version: number;
  timestamp: string;
  cwd: string;
  is_git: boolean;
  diff?: DiffData;
  plan?: string;
}

export interface GitStatus {
  has_unstaged: boolean;
  has_staged: boolean;
  has_unpushed: boolean;
  commits_behind: number;
  branch: string;
}

export interface RepoInfo {
  name: string;
  branch: string;
  commits_behind: number;
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
}
