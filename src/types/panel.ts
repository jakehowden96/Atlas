export interface Concern {
  severity: "info" | "warning" | "error";
  description: string;
  file?: string;
  line?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  edge_type?: string;
}

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

export interface SummaryData {
  intent: string;
  approach: string;
  impact: string;
  concerns: Concern[];
}

export interface FlowData {
  edges: FlowEdge[];
  changed_nodes?: string[];
}

export interface PanelData {
  version: number;
  timestamp: string;
  cwd: string;
  is_git: boolean;
  diff?: DiffData;
  plan?: string;
  summary?: SummaryData;
  flow?: FlowData;
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

export type PanelSection = "diff" | "summary" | "flow";

export type AnalysisStatus = "idle" | "running" | "complete" | "error";

export interface AnalysisStatusEvent {
  session_id: string;
  status: AnalysisStatus;
  error?: string;
}
