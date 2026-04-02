export interface Issue {
  severity: "info" | "warning" | "error";
  file: string;
  line: number;
  message: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
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
  summary: string;
  fix: string;
  why: string;
  confidence: number;
  issues: Issue[];
}

export interface FlowData {
  edges: FlowEdge[];
  mermaid?: string;
}

export interface PanelData {
  version: number;
  timestamp: string;
  cwd: string;
  diff?: DiffData;
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

export type PanelSection = "diff" | "summary" | "flow";

export type AnalysisStatus = "idle" | "running" | "complete" | "error";

export interface AnalysisStatusEvent {
  session_id: string;
  status: AnalysisStatus;
  error?: string;
}
