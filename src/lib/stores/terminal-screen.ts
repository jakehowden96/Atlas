import { writable } from "svelte/store";

/**
 * What each terminal is showing right now, as plain text rows, keyed by tab
 * id. `TerminalSession` publishes its xterm's visible buffer here after every
 * parsed write (one frame at most), and a Sessions-grid tile renders it. It is
 * read from the real xterm, so it is the screen as the TUI painted it — live
 * through a long tool call, which the transcript tail never was.
 */
export const terminalScreens = writable<ReadonlyMap<string, readonly string[]>>(new Map());

export function setTerminalScreen(tabId: string, rows: string[]): void {
  terminalScreens.update((m) => {
    const next = new Map(m);
    next.set(tabId, rows);
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
