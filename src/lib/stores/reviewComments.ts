import { writable, derived, get } from "svelte/store";
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
  shortId: string;     // r1/r2/... assigned at submit time
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
    shortId: "",
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

/**
 * Assign stable short IDs (r1, r2, ...) to every comment in the session and
 * return the updated list. Called immediately before submission so the IDs
 * Claude sees match what the user sees in the drawer.
 */
export function assignShortIdsForSubmit(sessionId: string): ReviewComment[] {
  const list = get(_comments).get(sessionId) ?? [];
  const stamped = list.map((c, i) => ({ ...c, shortId: `r${i + 1}` }));
  _comments.update((m) => {
    const next = new Map(m);
    next.set(sessionId, stamped);
    return next;
  });
  return stamped;
}

/**
 * Remove every comment whose shortId appears in `ackedIds`. Called when the
 * watcher sees Claude append to review-acks.txt.
 */
export function markAckedIds(sessionId: string, ackedIds: string[]) {
  if (ackedIds.length === 0) return;
  const set = new Set(ackedIds);
  mutate(sessionId, (list) => list.filter((c) => !c.shortId || !set.has(c.shortId)));
}

/** Stable DOM key for a comment anchor — used to find/scroll to the line. */
export function anchorDomKey(anchor: ReviewAnchor): string {
  return `${anchor.fileKey}|${anchor.side}|${anchor.oldNum ?? ""}|${anchor.newNum ?? ""}`;
}
