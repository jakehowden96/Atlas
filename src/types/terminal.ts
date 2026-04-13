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

export interface MarkdownTab {
  type: "markdown";
  id: string;
  title: string;
  content: string;
  filePath?: string;
  workspacePath?: string;
}

export type TabItem = TerminalTab | MarkdownTab;
