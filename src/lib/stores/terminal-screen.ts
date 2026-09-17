import { writable } from "svelte/store";

/**
 * One run of same-styled text within a terminal row. `fg`/`bg` are ANSI
 * palette indices 0–15 (the named slots `theme.ts` defines); anything else
 * the TUI painted — RGB, 256-colour, or no colour at all — is left
 * `undefined` and rendered in the pane's default ink.
 */
export interface TerminalSegment {
  text: string;
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

export type TerminalRow = readonly TerminalSegment[];

/**
 * What each terminal is showing right now, keyed by tab id.
 * `TerminalSession` publishes its xterm's visible buffer here after every
 * parsed write (one frame at most), and a Sessions-grid tile renders it. It
 * is read from the real xterm, so it is the screen as the TUI painted it —
 * live through a long tool call, which the transcript tail never was.
 *
 * `plain` is each row's text with no styling, for `overview.ts#screenPreview`
 * to find the prompt box and blank tail in. `styled` is the same rows split
 * into `TerminalRow`s carrying the colour and weight the TUI painted them
 * with, which is what a tile actually renders.
 */
export interface TerminalScreen {
  plain: readonly string[];
  styled: readonly TerminalRow[];
}

export const terminalScreens = writable<ReadonlyMap<string, TerminalScreen>>(new Map());

export function setTerminalScreen(tabId: string, plain: string[], styled: TerminalRow[]): void {
  terminalScreens.update((m) => {
    const next = new Map(m);
    next.set(tabId, { plain, styled });
    return next;
  });
}

export function clearTerminalScreen(tabId: string): void {
  terminalScreens.update((m) => {
    if (!m.has(tabId)) return m;
    const next = new Map(m);
    next.delete(tabId);
    return next;
  });
}
