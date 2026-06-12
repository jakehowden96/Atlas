import { writable, derived } from "svelte/store";
import { activeTabId } from "./terminal";

/**
 * Anchor identifying the diff location a comment is attached to. The richer-
 * than-needed shape (snippet + hunk header) is captured up front so future
 * "outdated" / re-anchor logic can land additively. V1 just nukes a session's
 * comments on the next diff refresh.
 */
export interface ReviewAnchor {
  fileKey: string;
  side: "+" | "-" | " ";
  oldNum: number | null;
  newNum: number | null;
  hunkHeader: string;
  contentSnippet: string;
}

export interface ReviewComment {
  id: string;          // internal uuid
  sessionId: string;
  anchor: ReviewAnchor;
  body: string;
  createdAt: number;
}

/** Map<sessionId, ReviewComment[]> keyed in insertion order per session. */
const _comments = writable<Map<string, ReviewComment[]>>(new Map());

export const reviewComments = { subscribe: _comments.subscribe };

/** Comments for the currently active session — convenient for UI binding. */
export const activeSessionComments = derived(
  [_comments, activeTabId],
  ([$c, $id]) => $c.get($id) ?? [],
);

function mutate(sessionId: string, fn: (list: ReviewComment[]) => ReviewComment[]) {
  _comments.update((m) => {
    const next = new Map(m);
    const list = next.get(sessionId) ?? [];
    const updated = fn(list);
    if (updated.length === 0) next.delete(sessionId);
    else next.set(sessionId, updated);
    return next;
  });
}

export function addComment(
  sessionId: string,
  anchor: ReviewAnchor,
  body: string,
): ReviewComment {
  const comment: ReviewComment = {
    id: crypto.randomUUID(),
    sessionId,
    anchor,
    body,
    createdAt: Date.now(),
  };
  mutate(sessionId, (list) => [...list, comment]);
  return comment;
}

export function removeComment(sessionId: string, id: string) {
  mutate(sessionId, (list) => list.filter((c) => c.id !== id));
}

export function clearForSession(sessionId: string) {
  _comments.update((m) => {
    if (!m.has(sessionId)) return m;
    const next = new Map(m);
    next.delete(sessionId);
    return next;
  });
}

/** Stable DOM key for a comment anchor — used to find/scroll to the line. */
export function anchorDomKey(anchor: ReviewAnchor): string {
  return `${anchor.fileKey}|${anchor.side}|${anchor.oldNum ?? ""}|${anchor.newNum ?? ""}`;
}
