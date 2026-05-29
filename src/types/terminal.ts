import type { Terminal } from "@xterm/xterm";

export interface TerminalTab {
  type: "terminal";
  id: string;
  title: string;
  ptyId: number;
  terminal: Terminal;
  cwd?: string;
  onData?: (data: string) => void;
  needsInput?: boolean;
  ready?: boolean;
  commandWrittenAt?: number;
  /** Stable role marker for singleton terminal tabs (e.g. "prs"). */
  role?: "prs";
  /** When true, the right-side diff panel stays hidden while this tab is active. */
  suppressPanel?: boolean;
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
