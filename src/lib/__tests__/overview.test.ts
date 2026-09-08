import { describe, expect, it } from "vitest";

import type { LiveSession, SessionState } from "../../types/session";
import {
  buildTiles,
  compareByAttention,
  filterByWorkspace,
  compareByWorkspace,
  formatElapsed,
  pinKey,
  planSegments,
  tileComparator,
  type SessionTile,
} from "../overview";
import type { DiffStats, Workspace } from "../stores/workspace";

function live(sessionUuid: string, overrides: Partial<LiveSession> = {}): LiveSession {
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

function workspace(
  path: string,
  sessions: { id: string; claudeSessionId: string | null; terminalTabId: string | null }[],
): Workspace {
  return {
    path,
    name: path.split("/").pop() ?? path,
    color: "#2fa37a",
    sessions: sessions.map((s) => ({
      id: s.id,
      label: `Session ${s.id}`,
      status: "running" as const,
      age: "",
      terminalTabId: s.terminalTabId,
      createdAt: "2026-01-01T00:00:00.000Z",
      claudeSessionId: s.claudeSessionId,
    })),
  };
}

const diff = (linesAdded: number, linesRemoved: number): DiffStats => ({
  filesChanged: 1,
  linesAdded,
  linesRemoved,
});

describe("compareByWorkspace", () => {
  const rows = [
    { workspaceName: "Zebra", label: "b" },
    { workspaceName: "Atlas", label: "b" },
    { workspaceName: "Atlas", label: "a" },
  ];

  it("groups by workspace, then orders by label", () => {
    expect([...rows].sort(compareByWorkspace)).toEqual([
      { workspaceName: "Atlas", label: "a" },
      { workspaceName: "Atlas", label: "b" },
      { workspaceName: "Zebra", label: "b" },
    ]);
  });
});

describe("tileComparator", () => {
  it("maps attention and workspace to their comparators", () => {
    expect(tileComparator("attention")).toBe(compareByAttention);
    expect(tileComparator("workspace")).toBe(compareByWorkspace);
  });

  it("returns null for manual, leaving arrival order alone", () => {
    expect(tileComparator("manual")).toBeNull();
  });

  describe("with pinned tiles", () => {
    // The comparator only reads these fields off a tile. `atlasSessionId` is
    // blank so these pin by transcript UUID, the unowned-session case.
    const tile = (sessionUuid: string, state: SessionState, label = sessionUuid) =>
      ({ sessionUuid, atlasSessionId: "", state, label, workspaceName: "ws" }) as SessionTile;

    const order = (
      tiles: SessionTile[],
      ordering: Parameters<typeof tileComparator>[0],
      pinned: string[],
    ) => {
      const cmp = tileComparator(ordering, new Set(pinned));
      return (cmp ? [...tiles].sort(cmp) : [...tiles]).map((t) => t.sessionUuid);
    };

    it("lifts pinned tiles above the rest", () => {
      const tiles = [tile("a", "idle"), tile("b", "needsYou"), tile("c", "idle")];
      expect(order(tiles, "attention", ["c"])).toEqual(["c", "b", "a"]);
    });

    it("still orders within each group", () => {
      const tiles = [tile("a", "idle"), tile("b", "needsYou"), tile("c", "running")];
      expect(order(tiles, "attention", ["a", "b"])).toEqual(["b", "a", "c"]);
    });

    it("keeps arrival order under manual, pinned first", () => {
      const tiles = [tile("a", "idle"), tile("b", "idle"), tile("c", "idle")];
      expect(order(tiles, "manual", ["c", "b"])).toEqual(["b", "c", "a"]);
    });

    it("hands back the plain comparator when nothing is pinned", () => {
      expect(tileComparator("attention", new Set())).toBe(compareByAttention);
      expect(tileComparator("manual", new Set())).toBeNull();
    });

    it("pins an Atlas-owned session by its row id, not its transcript uuid", () => {
      const owned = {
        sessionUuid: "uuid-b",
        atlasSessionId: "row-b",
        state: "idle",
        label: "b",
        workspaceName: "ws",
      } as SessionTile;
      expect(pinKey(owned)).toBe("row-b");
      expect(order([tile("a", "idle"), owned], "manual", ["row-b"])).toEqual([
        "uuid-b",
        "a",
      ]);
      // The transcript uuid is not what the pin is stored under.
      expect(order([tile("a", "idle"), owned], "manual", ["uuid-b"])).toEqual([
        "a",
        "uuid-b",
      ]);
    });
  });
});

describe("compareByAttention", () => {
  const ordered = (states: SessionState[]) =>
    states.map((state) => ({ state })).sort(compareByAttention).map((t) => t.state);

  it("puts needs-you first, then running/error, then idle", () => {
    expect(ordered(["idle", "running", "needsYou", "error"])).toEqual([
      "needsYou",
      "running",
      "error",
      "idle",
    ]);
  });

  it("ranks running and error equally, keeping arrival order", () => {
    expect(compareByAttention({ state: "running" }, { state: "error" })).toBe(0);
    expect(ordered(["error", "running"])).toEqual(["error", "running"]);
  });

  it("re-sorts when a running session starts needing you", () => {
    const tiles: { id: string; state: SessionState }[] = [
      { id: "a", state: "running" },
      { id: "b", state: "idle" },
      { id: "c", state: "running" },
    ];
    tiles[2].state = "needsYou";
    expect([...tiles].sort(compareByAttention).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

describe("filterByWorkspace", () => {
  const tiles = [
    { workspacePath: "/code/atlas" },
    { workspacePath: "/code/docs" },
    { workspacePath: "/code/atlas" },
  ];

  it('returns everything for "all"', () => {
    expect(filterByWorkspace(tiles, "all")).toHaveLength(3);
  });

  it("keeps only the matching workspace", () => {
    expect(filterByWorkspace(tiles, "/code/atlas")).toEqual([
      { workspacePath: "/code/atlas" },
      { workspacePath: "/code/atlas" },
    ]);
  });

  it("returns nothing for an unknown workspace", () => {
    expect(filterByWorkspace(tiles, "/code/gone")).toEqual([]);
  });
});

describe("buildTiles", () => {
  const workspaceList = [
    workspace("/code/atlas", [{ id: "row-a", claudeSessionId: "uuid-a", terminalTabId: "tab-a" }]),
    workspace("/code/docs", [{ id: "row-b", claudeSessionId: "uuid-b", terminalTabId: "tab-b" }]),
  ];

  it("joins diff stats through the terminal tab id, not the Claude uuid", () => {
    const stats = new Map([
      ["tab-a", diff(10, 2)],
      ["tab-b", diff(99, 99)],
      // Same key space as the Claude uuids: picking these up would be the bug.
      ["uuid-a", diff(1, 1)],
    ]);
    const [a, b] = buildTiles([live("uuid-a"), live("uuid-b")], workspaceList, stats, new Set());
    expect(a.diff).toEqual(diff(10, 2));
    expect(b.diff).toEqual(diff(99, 99));
  });

  it("carries workspace identity across from the owning row", () => {
    const tiles = buildTiles([live("uuid-b")], workspaceList, new Map(), new Set());
    const tile = tiles.find((t) => t.sessionUuid === "uuid-b");
    expect(tile).toMatchObject({
      atlasSessionId: "row-b",
      terminalTabId: "tab-b",
      workspacePath: "/code/docs",
      workspaceName: "docs",
      workspaceColour: "#2fa37a",
    });
  });

  it("still renders a session no workspace row owns", () => {
    const tiles = buildTiles([live("orphan")], workspaceList, new Map(), new Set());
    const tile = tiles.find((t) => t.sessionUuid === "orphan");
    expect(tile).toBeDefined();
    expect(tile?.atlasSessionId).toBe("");
    expect(tile?.terminalTabId).toBeNull();
    expect(tile?.diff).toBeNull();
    expect(tile?.label).toBe("Session");
  });

  /* A spawned session has a PTY long before its transcript exists, and with
     transcript saving off it never gets one. Neither may hide it. */
  it("renders an open session that has no transcript yet", () => {
    const tiles = buildTiles([], workspaceList, new Map(), new Set());
    expect(tiles).toHaveLength(2);
    const tile = tiles.find((t) => t.sessionUuid === "uuid-a");
    expect(tile).toMatchObject({
      atlasSessionId: "row-a",
      terminalTabId: "tab-a",
      workspacePath: "/code/atlas",
      state: "running",
      label: "Session row-a",
    });
    expect(tile?.live.lines).toEqual([]);
    expect(tile?.live.costEstimate).toBe(0);
  });

  it("does not tile a persisted session that is not open", () => {
    const closed = [
      workspace("/code/atlas", [
        { id: "row-a", claudeSessionId: "uuid-a", terminalTabId: null },
      ]),
    ];
    expect(buildTiles([], closed, new Map(), new Set())).toHaveLength(0);
  });

  it("does not double-count a row whose live session has arrived", () => {
    const tiles = buildTiles([live("uuid-a")], workspaceList, new Map(), new Set());
    expect(tiles.filter((t) => t.sessionUuid === "uuid-a")).toHaveLength(1);
  });

  it("prefers the transcript title, falling back to the workspace label", () => {
    const tiles = buildTiles(
      [live("uuid-a", { title: "Fix the race" }), live("uuid-b")],
      workspaceList,
      new Map(),
      new Set(),
    );
    expect(tiles.find((t) => t.sessionUuid === "uuid-a")?.label).toBe("Fix the race");
    expect(tiles.find((t) => t.sessionUuid === "uuid-b")?.label).toBe("Session row-b");
  });

  it("promotes a session to needsYou when its tab was flagged by the hook", () => {
    const [tile] = buildTiles([live("uuid-a")], workspaceList, new Map(), new Set(["tab-a"]));
    expect(tile.state).toBe("needsYou");
  });

  it("leaves other sessions' states alone", () => {
    const [, b] = buildTiles(
      [live("uuid-a"), live("uuid-b", { state: "idle" })],
      workspaceList,
      new Map(),
      new Set(["tab-a"]),
    );
    expect(b.state).toBe("idle");
  });
});

describe("planSegments", () => {
  it("is empty with no plan", () => {
    expect(planSegments([])).toEqual([false, false, false, false, false, false]);
  });

  it("fills in proportion to completed todos", () => {
    const plan = [
      { text: "a", status: "completed" },
      { text: "b", status: "completed" },
      { text: "c", status: "in_progress" },
      { text: "d", status: "pending" },
    ];
    expect(planSegments(plan).filter(Boolean)).toHaveLength(3);
  });

  it("fills every segment when the plan is done", () => {
    const plan = [
      { text: "a", status: "completed" },
      { text: "b", status: "completed" },
    ];
    expect(planSegments(plan).every(Boolean)).toBe(true);
  });
});

describe("formatElapsed", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");

  it("is empty without a start timestamp", () => {
    expect(formatElapsed(null, start)).toBe("");
    expect(formatElapsed("not a date", start)).toBe("");
  });

  it("pads seconds under an hour", () => {
    expect(formatElapsed("2026-01-01T00:00:00.000Z", start + 134_000)).toBe("2m 14s");
    expect(formatElapsed("2026-01-01T00:00:00.000Z", start + 3_000)).toBe("0m 03s");
  });

  it("switches to hours past an hour", () => {
    expect(formatElapsed("2026-01-01T00:00:00.000Z", start + 3_840_000)).toBe("1h 04m");
  });

  it("never goes negative on clock skew", () => {
    expect(formatElapsed("2026-01-01T00:00:00.000Z", start - 5_000)).toBe("0m 00s");
  });
});
