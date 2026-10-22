import { derived, writable } from "svelte/store";
import type { LiveSession } from "../../types/generated/LiveSession";

/** Live state of every session Atlas is currently tailing, keyed by session UUID. */
export const liveSessions = writable<Map<string, LiveSession>>(new Map());

/** UUIDs whose tail was stopped. A `session-update` sent before a stop can
 *  arrive after it, because Tauri events and invoke responses aren't ordered
 *  relative to each other; without this it would re-insert a session nothing
 *  will ever remove. */
const retired = new Set<string>();

export function upsertLiveSession(session: LiveSession) {
  if (retired.has(session.sessionUuid)) return;
  liveSessions.update((sessions) => {
    const next = new Map(sessions);
    next.set(session.sessionUuid, session);
    return next;
  });
}

export function removeLiveSession(sessionUuid: string) {
  retired.add(sessionUuid);
  liveSessions.update((sessions) => {
    if (!sessions.has(sessionUuid)) return sessions;
    const next = new Map(sessions);
    next.delete(sessionUuid);
    return next;
  });
}

/** Accept updates for a UUID again, once a tail is about to start for it. */
export function reviveLiveSession(sessionUuid: string) {
  retired.delete(sessionUuid);
}

/** Test seam: forget every retired UUID and every live session. */
export function resetLiveSessions() {
  retired.clear();
  liveSessions.set(new Map());
}

export const liveSessionList = derived(liveSessions, ($liveSessions) =>
  Array.from($liveSessions.values()),
);
