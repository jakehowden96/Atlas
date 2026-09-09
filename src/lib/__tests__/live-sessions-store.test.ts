import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import {
  liveSessionList,
  liveSessions,
  removeLiveSession,
  upsertLiveSession,
} from "../stores/liveSessions";
import type { LiveSession } from "../../types/session";

function session(sessionUuid: string, overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    sessionUuid,
    state: "running",
    startedAt: null,
    lastActivity: null,
    title: null,
    model: null,
    gitBranch: null,
    lines: [],
    plan: [],
    subagents: [],
    toolCalls: 0,
    lastTool: null,
    pendingTool: null,
    outputTokens: 0,
    costEstimate: 0,
    peakContext: 0,
    contextPct: 0,
    ...overrides,
  };
}

describe("liveSessions store", () => {
  beforeEach(() => {
    liveSessions.set(new Map());
  });

  it("adds a session on first upsert", () => {
    upsertLiveSession(session("a"));
    expect(get(liveSessions).size).toBe(1);
    expect(get(liveSessions).get("a")?.sessionUuid).toBe("a");
  });

  it("replaces an existing session rather than duplicating it", () => {
    upsertLiveSession(session("a", { toolCalls: 1 }));
    upsertLiveSession(session("a", { toolCalls: 7 }));
    expect(get(liveSessions).size).toBe(1);
    expect(get(liveSessions).get("a")?.toolCalls).toBe(7);
  });

  it("emits a new Map so subscribers see the change", () => {
    const seen: number[] = [];
    const unsubscribe = liveSessions.subscribe((m) => seen.push(m.size));
    upsertLiveSession(session("a"));
    upsertLiveSession(session("b"));
    unsubscribe();
    expect(seen).toEqual([0, 1, 2]);
  });

  it("removes a session", () => {
    upsertLiveSession(session("a"));
    upsertLiveSession(session("b"));
    removeLiveSession("a");
    expect([...get(liveSessions).keys()]).toEqual(["b"]);
  });

  it("ignores removal of an unknown session", () => {
    upsertLiveSession(session("a"));
    const before = get(liveSessions);
    removeLiveSession("nope");
    expect(get(liveSessions)).toBe(before);
  });

  it("derives a list of sessions", () => {
    upsertLiveSession(session("a"));
    upsertLiveSession(session("b"));
    expect(get(liveSessionList).map((s) => s.sessionUuid)).toEqual(["a", "b"]);
  });
});
