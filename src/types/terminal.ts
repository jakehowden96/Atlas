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
}

/** Singleton screen showing open PRs across watched repos. Not a PTY. */
export interface PrsTab {
  type: "prs";
  id: string;
  title: string;
}

/** Singleton screen showing Claude Code session stats. Not a PTY. */
export interface StatsTab {
  type: "stats";
  id: string;
  title: string;
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

export type TabItem = TerminalTab | FileTab | PrsTab | StatsTab;
