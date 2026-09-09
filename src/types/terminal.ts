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
  /** False until Claude Code's TUI enters the alternate screen buffer. The
   *  terminal stays hidden behind the "Starting Claude Code…" overlay until
   *  then, so the shell prompt and the launch command are never shown. */
  ready?: boolean;
}

/**
 * Every tab is a Claude session PTY. PRs and Stats are top-level views now
 * (`stores/view.ts`), and file tabs were removed with the sidebar.
 */
export type TabItem = TerminalTab;
