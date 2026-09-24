import { derived, writable } from "svelte/store";
import type { LiveSession } from "../../types/session";

/** Live state of every session Atlas is currently tailing, keyed by session UUID. */
export const liveSessions = writable<Map<string, LiveSession>>(new Map());

export function upsertLiveSession(session: LiveSession) {
  liveSessions.update((sessions) => {
    const next = new Map(sessions);
    next.set(session.sessionUuid, session);
    return next;
  });
}

export function removeLiveSession(sessionUuid: string) {
  liveSessions.update((sessions) => {
    if (!sessions.has(sessionUuid)) return sessions;
    const next = new Map(sessions);
    next.delete(sessionUuid);
    return next;
  });
}

export const liveSessionList = derived(liveSessions, ($liveSessions) =>
  Array.from($liveSessions.values()),
);
