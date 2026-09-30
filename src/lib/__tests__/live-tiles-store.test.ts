import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const buildTiles = vi.hoisted(() => vi.fn());

vi.mock("../overview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../overview")>();
  buildTiles.mockImplementation(actual.buildTiles);
  return { ...actual, buildTiles };
});
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Home: 1 },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { liveTiles } from "../stores/liveTiles";
import { upsertLiveSession } from "../stores/liveSessions";
import { addTab, setTabNeedsInput, setTabReady, tabs } from "../stores/terminal";
import { workspaces } from "../stores/workspace";
import type { LiveSession } from "../../types/session";

function live(sessionUuid: string): LiveSession {
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
    contextTokens: 0,
    peakContext: 0,
    contextPct: 0,
    lastPrompt: null,
    lastReply: null,
    turnEndedAt: null,
    turnDurationMs: null,
  };
}

describe("liveTiles", () => {
  beforeEach(() => {
    tabs.set([]);
    workspaces.set([
      {
        path: "/w",
        name: "w",
        sessions: [
          {
            id: "row-1",
            label: "Session",
            status: "running",
            terminalTabId: "t1",
            createdAt: "2026-09-01T00:00:00Z",
            claudeSessionId: "u1",
            harnessId: "claude-code",
          },
        ],
      },
    ]);
    upsertLiveSession(live("u1"));
  });

  it("joins once per update however many places read it", () => {
    const readers = [
      liveTiles.subscribe(() => {}),
      liveTiles.subscribe(() => {}),
      liveTiles.subscribe(() => {}),
    ];
    buildTiles.mockClear();

    upsertLiveSession({ ...live("u1"), toolCalls: 3 });

    expect(buildTiles).toHaveBeenCalledTimes(1);
    for (const stop of readers) stop();
  });

  it("is not re-joined by tab changes that leave the needs-input flags alone", () => {
    addTab({ type: "terminal", id: "t1", ptyId: -1 });
    const stop = liveTiles.subscribe(() => {});
    buildTiles.mockClear();

    setTabReady("t1");
    tabs.update((t) => t.map((tab) => ({ ...tab, ptyId: 7 })));

    expect(buildTiles).not.toHaveBeenCalled();
    stop();
  });

  it("turns a tile to needs-you when the hook flags its tab", () => {
    addTab({ type: "terminal", id: "t1", ptyId: 7 });
    const stop = liveTiles.subscribe(() => {});

    setTabNeedsInput("t1", true, "permission_prompt");

    expect(get(liveTiles)[0].state).toBe("needsYou");
    stop();
  });
});
