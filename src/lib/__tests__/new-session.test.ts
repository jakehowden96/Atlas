import { describe, expect, it } from "vitest";

import {
  ageLabel,
  clampState,
  filterWorkspaces,
  findWorkspace,
  handleKey,
  INITIAL_STATE,
  KEY_HINTS,
  looksLikeAbsolutePath,
  moveWithin,
  normalizePath,
  rankJumpRows,
  recencyOf,
  setMode,
  toggleColumn,
  type JumpRow,
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

  it("leaves bare left/right to the filter input's caret", () => {
    expect(handleKey({ key: "ArrowLeft" }, state(), counts(3, 2)).handled).toBe(false);
    expect(handleKey({ key: "ArrowRight" }, state(), counts(3, 2)).handled).toBe(false);
  });

  it("Shift+←/→ moves between the columns, directionally", () => {
    const c = counts(3, 2);
    const onWorkspaces = state({ mode: "resume" });
    const right = handleKey({ key: "ArrowRight", shiftKey: true }, onWorkspaces, c);
    expect(right.state.column).toBe("resume");
    expect(right.handled).toBe(true);
    expect(handleKey({ key: "ArrowLeft", shiftKey: true }, right.state, c).state.column).toBe(
      "workspaces",
    );
  });

  it("Shift+←/→ never moves the wrong way, and is a no-op at either end", () => {
    const c = counts(3, 2);
    const onResume = state({ mode: "resume", column: "resume" });
    // Shift+→ while already on the right must not toggle back to the left.
    expect(handleKey({ key: "ArrowRight", shiftKey: true }, onResume, c).state.column).toBe(
      "resume",
    );
    expect(
      handleKey({ key: "ArrowLeft", shiftKey: true }, state({ mode: "resume" }), c).state.column,
    ).toBe("workspaces");
  });

  it("Shift+←/→ still claims the key when there is no second column", () => {
    // Fresh mode has one column; the chord must not fall through to the input's
    // text selection just because nothing moved.
    const r = handleKey({ key: "ArrowRight", shiftKey: true }, state(), counts(3, 2));
    expect(r.state.column).toBe("workspaces");
    expect(r.handled).toBe(true);
    expect(
      handleKey({ key: "ArrowRight", shiftKey: true }, state({ mode: "resume" }), counts(3, 0))
        .state.column,
    ).toBe("workspaces");
  });

  it("toggleColumn only reaches Resume when that mode has rows", () => {
    const resumeState = state({ mode: "resume", column: "resume" });
    expect(toggleColumn(resumeState, counts(3, 2)).column).toBe("workspaces");
    expect(toggleColumn(state({ mode: "resume" }), counts(3, 2)).column).toBe("resume");
    expect(toggleColumn(state({ mode: "resume" }), counts(3, 0)).column).toBe("workspaces");
    expect(toggleColumn(state({ mode: "fresh" }), counts(3, 2)).column).toBe("workspaces");
  });

  it("leaves an unmodified Backspace to the filter input", () => {
    expect(handleKey({ key: "Backspace" }, state({ wsIndex: 1 }), counts(3, 0)).handled).toBe(
      false,
    );
  });
});

describe("New ↔ Resume", () => {
  it("Tab flips the mode, and flips it back", () => {
    const c = counts(3, 2);
    const toResume = handleKey({ key: "Tab" }, state(), c);
    expect(toResume.state.mode).toBe("resume");
    expect(toResume.state.column).toBe("resume");
    expect(toResume.handled).toBe(true);
    expect(toResume.effect).toBeNull();
    expect(handleKey({ key: "Tab" }, toResume.state, c).state.mode).toBe("fresh");
  });

  it("Shift+Tab flips it too — there are only the two modes", () => {
    expect(handleKey({ key: "Tab", shiftKey: true }, state(), counts(3, 2)).state.mode).toBe(
      "resume",
    );
  });

  it("Tab into Resume with nothing to resume leaves focus on the workspaces", () => {
    const r = handleKey({ key: "Tab" }, state(), counts(3, 0));
    expect(r.state.mode).toBe("resume");
    expect(r.state.column).toBe("workspaces");
  });

  it("Tab keeps the workspace, and clamps a stale index on the way", () => {
    // wsIndex 9 with only 2 workspaces is really the add row at index 2.
    const r = handleKey({ key: "Tab" }, state({ wsIndex: 9 }), counts(2, 3));
    expect(r.state.mode).toBe("resume");
    expect(r.state.wsIndex).toBe(2);
  });

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

describe("rankJumpRows", () => {
  const row = (kind: JumpRow["kind"], label: string, haystack = ""): JumpRow => ({
    kind,
    id: `${kind}:${label}`,
    label,
    context: "",
    haystack,
  });

  const tiles = [
    row("session", "Fix the parser", "Atlas main"),
    row("session", "Bump deps", "RogueMagic chore/deps"),
  ];

  it("returns everything for an empty query", () => {
    expect(rankJumpRows(tiles, "  ")).toHaveLength(2);
  });

  it("matches the label or anything in the haystack", () => {
    expect(rankJumpRows(tiles, "parser").map((r) => r.label)).toEqual(["Fix the parser"]);
    expect(rankJumpRows(tiles, "roguemagic").map((r) => r.label)).toEqual(["Bump deps"]);
    expect(rankJumpRows(tiles, "chore/").map((r) => r.label)).toEqual(["Bump deps"]);
    expect(rankJumpRows(tiles, "nope")).toEqual([]);
  });

  it("groups an empty query by kind, keeping each group's incoming order", () => {
    const mixed = [
      row("pr", "Ship it"),
      row("doc", "README.md"),
      row("session", "Fix the parser"),
      row("doc", "ARCHITECTURE.md"),
    ];
    expect(rankJumpRows(mixed, "").map((r) => r.label)).toEqual([
      "Fix the parser",
      "README.md",
      "ARCHITECTURE.md",
      "Ship it",
    ]);
  });

  it("ranks a label prefix over a label substring over a haystack match", () => {
    const rows = [
      row("session", "Nothing to see", "auth"),
      row("session", "Rework auth"),
      row("session", "Auth rewrite"),
    ];
    expect(rankJumpRows(rows, "auth").map((r) => r.label)).toEqual([
      "Auth rewrite",
      "Rework auth",
      "Nothing to see",
    ]);
  });

  it("does not reorder between two queries matching the same rows", () => {
    const rows = [
      row("pr", "auth: refresh tokens"),
      row("session", "auth rewrite"),
      row("doc", "auth-notes.md"),
    ];
    expect(rankJumpRows(rows, "auth").map((r) => r.id)).toEqual(
      rankJumpRows(rows, "au").map((r) => r.id),
    );
  });
});

describe("the keys the modal advertises", () => {
  /* The footer offered "⌘⌫ remove" long after that binding was reverted, so a
     keyboard-only user pressed it and nothing happened. The hints are data now,
     and every one of them has to be a press the model actually claims. */
  it("are all claimed by handleKey", () => {
    const counts = { workspaces: 2, resumable: 2 };
    // Resume mode with the Resume column focused: the state in which every
    // hint, the column key included, is meaningful.
    const state = { ...INITIAL_STATE, mode: "resume" as const, column: "resume" as const };
    for (const hint of KEY_HINTS) {
      const result = handleKey(hint.probe, state, counts);
      expect(result.handled, `${hint.keys} ${hint.label} is advertised but unhandled`).toBe(
        true,
      );
    }
  });

  it("covers every effect the modal can be driven to", () => {
    const labels = KEY_HINTS.map((h) => h.label);
    expect(labels).toContain("start");
    expect(labels).toContain("add workspace");
    expect(labels).toContain("New / Resume");
  });

  it("hides the column key until there is a Resume column to move into", () => {
    const column = KEY_HINTS.find((h) => h.label === "column");
    expect(column?.resumeOnly).toBe(true);
    // Everything else is unconditional — those keys always work.
    for (const hint of KEY_HINTS.filter((h) => h.label !== "column")) {
      expect(hint.resumeOnly).toBeUndefined();
    }
  });
});
