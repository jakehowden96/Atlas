import type { Terminal } from "@xterm/xterm";

/** The `notification_type`s that flag a tab as waiting on the user. */
export type NeedsInputKind = "permission_prompt" | "elicitation_dialog";

export interface TerminalTab {
  type: "terminal";
  id: string;
  title: string;
  ptyId: number;
  terminal: Terminal;
  cwd?: string;
  onData?: (data: string) => void;
  needsInput?: boolean;
  /** Which Notification raised `needsInput`. Only a `permission_prompt` may be
   *  answered from a tile; an elicitation dialog is a different dialog. */
  needsInputKind?: NeedsInputKind;
  /** False until the harness's TUI enters the alternate screen buffer. The
   *  terminal stays hidden behind the "Starting <harness>…" overlay until
   *  then, so the shell prompt and the launch command are never shown. */
  ready?: boolean;
  /** The launched harness's label, named by that overlay. */
  harnessLabel?: string;
}

/**
 * Every tab is a Claude session PTY. PRs and Stats are top-level views now
 * (`stores/view.ts`), and file tabs were removed with the sidebar.
 */
export type TabItem = TerminalTab;
