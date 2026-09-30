/** The `notification_type`s that flag a tab as waiting on the user. */
export type NeedsInputKind = "permission_prompt" | "elicitation_dialog";

/** How a PTY's shell ended; the last message on its output channel. */
export interface PtyExit {
  /** Null when the status could not be collected (the shell was killed). */
  code: number | null;
  signal: string | null;
}

export interface TerminalTab {
  type: "terminal";
  id: string;
  ptyId: number;
  cwd?: string;
  needsInput?: boolean;
  /** Which Notification raised `needsInput`. Only a `permission_prompt` may be
   *  answered from a tile; an elicitation dialog is a different dialog. */
  needsInputKind?: NeedsInputKind;
  /** The shell behind this tab has exited. Its PTY is gone: nothing may be
   *  written to it, and the tab only shows what was left on screen. */
  exited?: boolean;
  /** Why the PTY could not be spawned; the tab shows it instead of waiting
   *  on a shell that is never coming. */
  spawnError?: string;
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
