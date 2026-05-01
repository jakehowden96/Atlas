export interface TerminalTab {
  type: "terminal";
  id: string;
  title: string;
  ptyId: number;
  cwd?: string;
  onData?: (data: string) => void;
  needsInput?: boolean;
  ready?: boolean;
  commandWrittenAt?: number;
  useStreamJson?: boolean;
  perTurnInvocation?: boolean;
  toolSessionId?: string;
  adapterId?: string;
  turnCount?: number;
  titleSource?: "auto" | "osc";
}

export type FileLanguage =
  | "markdown"
  | "plaintext"
  | "typescript"
  | "javascript"
  | "json"
  | "yaml"
  | "html"
  | "css"
  | "python"
  | "rust"
  | "toml"
  | "shell"
  | "unknown";

export interface FileTab {
  type: "file";
  id: string;
  title: string;
  content: string;
  filePath?: string;
  workspacePath?: string;
  language: FileLanguage;
  dirty: boolean;
  editing: boolean;
  originalContent: string;
}

export type TabItem = TerminalTab | FileTab;
