import { writable } from "svelte/store";
import type { PanelData } from "../../types/panel";
import type { TouchedFile } from "../session-view";

export const panelData = writable<PanelData | null>(null);

/**
 * Per-file line counts for every session Atlas has heard a `panel-update`
 * from, keyed by terminal tab id like `sessionDiffStats`.
 *
 * `panelData` only ever holds the focused session's diff, and `sessionDiffStats`
 * only its totals — neither can answer the Files rail's question, which is
 * which sessions have touched *this* file.
 */
export const sessionTouchedFiles = writable<Map<string, TouchedFile[]>>(new Map());

export function setSessionTouchedFiles(sessionId: string, files: TouchedFile[]) {
  sessionTouchedFiles.update((current) => {
    const next = new Map(current);
    if (files.length === 0) next.delete(sessionId);
    else next.set(sessionId, files);
    return next;
  });
}
