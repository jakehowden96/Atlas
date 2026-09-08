import { describe, expect, it } from "vitest";

import type { SessionTile } from "../overview";
import {
  ageLabel,
  clampState,
  filterJumpRows,
  filterWorkspaces,
  findWorkspace,
  handleKey,
  INITIAL_STATE,
  looksLikeAbsolutePath,
  moveWithin,
  normalizePath,
  recencyOf,
  setMode,
  toggleColumn,
  type NewSessionCounts,
  type NewSessionState,
} from "../new-session";
import type { Workspace } from "../stores/workspace";

function ws(name: string, path: string, createdAt: string[] = []): Workspace {
  return {
    path,
    name,
    color: "#fff",
    sessions: createdAt.map((c, i) => ({
      id: `${name}-${i}`,
      label: name,
      status: "idle" as const,
      age: "",
      terminalTabId: null,
      createdAt: c,
      claudeSessionId: null,
    })),
  };
}

const counts = (workspaces: number, resumable: number): NewSessionCounts => ({
  workspaces,
  resumable,
});

const state = (over: Partial<NewSessionState> = {}): NewSessionState => ({
  ...INITIAL_STATE,
  ...over,
});

describe("normalizePath", () => {
  it("folds separators, trailing slash and case for Windows paths", () => {
    // The real trap: the folder picker and the transcript disagree on both.
    expect(normalizePath("C:\\Users\\jakeh\\Documents\\GitHub\\Atlas")).toBe(
      normalizePath("c:/users/JAKEH/documents/github/atlas/"),
    );
  });

  it("keeps case for POSIX paths, where it is significant", () => {
    expect(normalizePath("/repo/Atlas")).not.toBe(normalizePath("/repo/atlas"));
    expect(normalizePath("/repo/atlas/")).toBe(normalizePath("/repo/atlas"));
  });

  it("matches a workspace whose path style differs from the transcript cwd", () => {
    const list = [ws("Atlas", "C:/Users/jakeh/Documents/GitHub/Atlas")];
    const found = findWorkspace(list, "C:\\Users\\jakeh\\Documents\\GitHub\\Atlas\\");
    expect(found?.name).toBe("Atlas");
    expect(findWorkspace(list, "C:/Users/jakeh/Documents/GitHub/Other")).toBeUndefined();
  });
});

describe("looksLikeAbsolutePath", () => {
  it("accepts posix, home and windows paths", () => {
    expect(looksLikeAbsolutePath("/repo/atlas")).toBe(true);
    expect(looksLikeAbsolutePath("~/code/atlas")).toBe(true);
    expect(looksLikeAbsolutePath("  C:\\repo\\atlas ")).toBe(true);
  });

  it("rejects a plain filter word", () => {
    expect(looksLikeAbsolutePath("atlas")).toBe(false);
    expect(looksLikeAbsolutePath("")).toBe(false);
  });
});

describe("filterWorkspaces", () => {
  const list = [
    ws("Old", "/repo/old", ["2026-01-01T00:00:00Z"]),
    ws("Atlas", "/repo/atlas", ["2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z"]),
    ws("Never", "/repo/never"),
  ];

  it("sorts most recently used first, never-used last", () => {
    expect(filterWorkspaces(list, "").map((w) => w.name)).toEqual(["Atlas", "Old", "Never"]);
  });

  it("matches on name, case-insensitively", () => {
    expect(filterWorkspaces(list, "ATL").map((w) => w.name)).toEqual(["Atlas"]);
  });

  it("matches on path, ignoring separator style", () => {
    expect(filterWorkspaces(list, "repo\\never").map((w) => w.name)).toEqual(["Never"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterWorkspaces(list, "zzz")).toEqual([]);
  });

  it("leaves the source list untouched", () => {
    filterWorkspaces(list, "");
    expect(list.map((w) => w.name)).toEqual(["Old", "Atlas", "Never"]);
  });

  it("scores a workspace by its newest session", () => {
    expect(recencyOf(list[1])).toBe(Date.parse("2026-06-01T00:00:00Z"));
    expect(recencyOf(list[2])).toBe(0);
  });
});

describe("ageLabel", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("steps through minutes, hours and days", () => {
    expect(ageLabel("2026-06-01T11:59:40Z", now)).toBe("just now");
    expect(ageLabel("2026-06-01T11:30:00Z", now)).toBe("30m ago");
    expect(ageLabel("2026-06-01T08:00:00Z", now)).toBe("4h ago");
    expect(ageLabel("2026-05-29T12:00:00Z", now)).toBe("3d ago");
  });

  it("survives a missing or unparseable timestamp", () => {
    expect(ageLabel(null, now)).toBe("never");
    expect(ageLabel("not a date", now)).toBe("never");
  });
});

describe("keyboard model", () => {
  it("moves down and up within the workspace column, wrapping past the add row", () => {
    // 3 workspaces + the always-present "Add workspace…" row = 4 stops.
    let s = state();
    for (const expected of [1, 2, 3, 0]) {
      s = moveWithin(s, counts(3, 0), 1);
      expect(s.wsIndex).toBe(expected);
    }
    s = moveWithin(s, counts(3, 0), -1);
    expect(s.wsIndex).toBe(3);
  });

  it("moves within the resume column when that is the focused one", () => {
    const s = moveWithin(
      state({ mode: "resume", column: "resume" }),
      counts(3, 2),
      1,
    );
    expect(s.resumeIndex).toBe(1);
    expect(s.wsIndex).toBe(0);
    expect(moveWithin(s, counts(3, 2), 1).resumeIndex).toBe(0);
  });

  it("Enter starts, and starts on the add row instead when that is selected", () => {
    const c = counts(3, 0);
    expect(handleKey({ key: "Enter" }, state({ wsIndex: 1 }), c).effect).toBe("start");
    expect(handleKey({ key: "Enter" }, state({ wsIndex: 3 }), c).effect).toBe("addFolder");
  });

  it("Escape closes", () => {
    const r = handleKey({ key: "Escape" }, state(), counts(3, 0));
    expect(r.effect).toBe("close");
    expect(r.handled).toBe(true);
  });

  it("⌘O / Ctrl+O opens the folder picker", () => {
    expect(handleKey({ key: "o", metaKey: true }, state(), counts(3, 0)).effect).toBe(
      "addFolder",
    );
    expect(handleKey({ key: "O", ctrlKey: true }, state(), counts(3, 0)).effect).toBe(
      "addFolder",
    );
  });

  it("leaves ordinary typing to the input", () => {
    const r = handleKey({ key: "a" }, state(), counts(3, 0));
    expect(r.handled).toBe(false);
    expect(r.effect).toBeNull();
  });

  it("leaves the arrow keys' caret behaviour alone by not binding left/right", () => {
    expect(handleKey({ key: "ArrowLeft" }, state(), counts(3, 2)).handled).toBe(false);
    expect(handleKey({ key: "ArrowRight" }, state(), counts(3, 2)).handled).toBe(false);
  });

  it("Tab moves focus between the columns, but only when Resume has rows", () => {
    const resumeState = state({ mode: "resume", column: "resume" });
    expect(toggleColumn(resumeState, counts(3, 2)).column).toBe("workspaces");
    expect(toggleColumn(state({ mode: "resume" }), counts(3, 2)).column).toBe("resume");
    expect(toggleColumn(state({ mode: "resume" }), counts(3, 0)).column).toBe("workspaces");
    expect(toggleColumn(state({ mode: "fresh" }), counts(3, 2)).column).toBe("workspaces");
  });
});

describe("Fresh ↔ Resume", () => {
  it("keeps the selected workspace across a round trip", () => {
    const picked = state({ wsIndex: 2 });
    const resume = setMode(picked, "resume", counts(4, 3));
    expect(resume.wsIndex).toBe(2);
    expect(resume.column).toBe("resume");
    const back = setMode(resume, "fresh", counts(4, 3));
    expect(back.wsIndex).toBe(2);
    expect(back.column).toBe("workspaces");
  });

  it("stays on the workspace column when the workspace has no history", () => {
    const s = setMode(state({ wsIndex: 1 }), "resume", counts(4, 0));
    expect(s.mode).toBe("resume");
    expect(s.column).toBe("workspaces");
    expect(s.wsIndex).toBe(1);
  });
});

describe("clampState", () => {
  it("pulls a stale index back onto the add row after filtering", () => {
    expect(clampState(state({ wsIndex: 7 }), counts(2, 0)).wsIndex).toBe(2);
  });

  it("drops resume focus when the resume list empties", () => {
    const s = clampState(
      state({ mode: "resume", column: "resume", resumeIndex: 4 }),
      counts(2, 0),
    );
    expect(s.column).toBe("workspaces");
    expect(s.resumeIndex).toBe(0);
  });

  it("returns the same object when nothing moved, so callers can assign freely", () => {
    const s = state({ wsIndex: 1 });
    expect(clampState(s, counts(3, 0))).toBe(s);
  });

  it("is applied before a key is acted on", () => {
    // wsIndex 9 with only 2 workspaces is really the add row at index 2.
    expect(handleKey({ key: "Enter" }, state({ wsIndex: 9 }), counts(2, 0)).effect).toBe(
      "addFolder",
    );
  });
});

describe("filterJumpRows", () => {
  const tile = (label: string, workspaceName: string, branch: string): SessionTile =>
    ({ label, workspaceName, branch }) as SessionTile;
  const tiles = [
    tile("Fix the parser", "Atlas", "main"),
    tile("Bump deps", "RogueMagic", "chore/deps"),
  ];

  it("returns everything for an empty query", () => {
    expect(filterJumpRows(tiles, "  ")).toHaveLength(2);
  });

  it("matches label, workspace name or branch", () => {
    expect(filterJumpRows(tiles, "parser").map((t) => t.label)).toEqual(["Fix the parser"]);
    expect(filterJumpRows(tiles, "roguemagic").map((t) => t.label)).toEqual(["Bump deps"]);
    expect(filterJumpRows(tiles, "chore/").map((t) => t.label)).toEqual(["Bump deps"]);
    expect(filterJumpRows(tiles, "nope")).toEqual([]);
  });
});
