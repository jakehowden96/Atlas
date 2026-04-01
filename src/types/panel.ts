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
  branch: string;
}

export type PanelSection = "diff" | "summary" | "flow";
