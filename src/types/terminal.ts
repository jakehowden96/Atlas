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

/**
 * Every tab is a Claude session PTY. PRs and Stats are top-level views now
 * (`stores/view.ts`), and file tabs were removed with the sidebar.
 */
export type TabItem = TerminalTab;
