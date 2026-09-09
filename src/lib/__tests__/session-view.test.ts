import { describe, expect, it } from "vitest";

import type { PanelData } from "../../types/panel";
import type { PlanItem, Subagent } from "../../types/session";
import {
  filesTouched,
  planCounts,
  planRowState,
  subagentMeta,
  tabIdForSession,
} from "../session-view";
import type { Workspace } from "../stores/workspace";

function panel(
  raw: string | undefined,
  projects?: NonNullable<PanelData["diff"]>["projects"],
): PanelData {
  return {
    version: 1,
    timestamp: "",
    cwd: "/repo",
    is_git: true,
    diff:
      raw === undefined
        ? undefined
        : { raw, files_changed: 0, lines_added: 0, lines_removed: 0, projects },
  };
}

function workspace(
  path: string,
  sessions: { id: string; terminalTabId: string | null }[],
): Workspace {
  return {
    path,
    name: path,
    sessions: sessions.map((s) => ({
      id: s.id,
      label: s.id,
      status: "running" as const,
      age: "",
      terminalTabId: s.terminalTabId,
      createdAt: "",
      claudeSessionId: null,
    })),
  };
}

function todo(text: string, status: string): PlanItem {
  return { text, status };
}

function agent(overrides: Partial<Subagent> = {}): Subagent {
  return {
    task: "Search",
    startedAt: null,
    finishedAt: null,
    toolCount: 0,
    done: false,
    ...overrides,
  };
}

const TWO_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 keep
+added one
+added two
-removed one
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 333..000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-bye again
`;

describe("filesTouched", () => {
  it("is empty when no panel data has arrived", () => {
    expect(filesTouched(null)).toEqual([]);
  });

  it("is empty when the panel carries no diff", () => {
    expect(filesTouched(panel(undefined))).toEqual([]);
    expect(filesTouched(panel(""))).toEqual([]);
  });

  it("counts added and removed lines per file from the git diff", () => {
    expect(filesTouched(panel(TWO_FILE_DIFF))).toEqual([
      { path: "src/a.ts", added: 2, removed: 1, repo: "" },
      { path: "src/gone.ts", added: 0, removed: 2, repo: "" },
    ]);
  });

  it("names the repo each file is in when the workspace holds several", () => {
    // `raw` is every project's diff concatenated, so reading it alone loses
    // which repo a file came from — and both repos here have a `src/a.ts`.
    const multi = panel(TWO_FILE_DIFF + TWO_FILE_DIFF, [
      { name: "api", raw: TWO_FILE_DIFF, files_changed: 2, lines_added: 2, lines_removed: 3 },
      { name: "web", raw: TWO_FILE_DIFF, files_changed: 2, lines_added: 2, lines_removed: 3 },
    ]);
    expect(filesTouched(multi)).toEqual([
      { path: "src/a.ts", added: 2, removed: 1, repo: "api" },
      { path: "src/gone.ts", added: 0, removed: 2, repo: "api" },
      { path: "src/a.ts", added: 2, removed: 1, repo: "web" },
      { path: "src/gone.ts", added: 0, removed: 2, repo: "web" },
    ]);
  });

  it("names a deleted file by its old path", () => {
    const rows = filesTouched(panel(TWO_FILE_DIFF));
    expect(rows[1].path).toBe("src/gone.ts");
  });
});

describe("tabIdForSession", () => {
  const list = [
    workspace("/one", [{ id: "s1", terminalTabId: "t1" }]),
    workspace("/two", [
      { id: "s2", terminalTabId: null },
      { id: "s3", terminalTabId: "t3" },
    ]),
  ];

  it("finds the tab across every workspace", () => {
    expect(tabIdForSession(list, "s1")).toBe("t1");
    expect(tabIdForSession(list, "s3")).toBe("t3");
  });

  it("returns empty when the session has no live tab", () => {
    expect(tabIdForSession(list, "s2")).toBe("");
    expect(tabIdForSession(list, "nope")).toBe("");
  });

  it("never matches on an empty session id", () => {
    expect(tabIdForSession(list, "")).toBe("");
  });
});

describe("planCounts", () => {
  it("counts completed todos against the total", () => {
    const plan = [
      todo("a", "completed"),
      todo("b", "in_progress"),
      todo("c", "pending"),
    ];
    expect(planCounts(plan)).toEqual({ done: 1, total: 3 });
  });

  it("is zero for an empty plan", () => {
    expect(planCounts([])).toEqual({ done: 0, total: 0 });
  });
});

describe("planRowState", () => {
  it("maps TodoWrite statuses onto the three checkbox states", () => {
    expect(planRowState(todo("a", "completed"))).toBe("done");
    expect(planRowState(todo("b", "in_progress"))).toBe("current");
    expect(planRowState(todo("c", "pending"))).toBe("pending");
  });

  it("treats an unknown status as pending", () => {
    expect(planRowState(todo("d", "queued"))).toBe("pending");
  });
});

describe("subagentMeta", () => {
  const now = Date.parse("2026-01-01T00:02:10Z");

  it("drops the clock when the start time is unknown", () => {
    expect(subagentMeta(agent({ toolCount: 4 }), now)).toBe("4 tools");
  });

  it("singularises a lone tool call", () => {
    expect(subagentMeta(agent({ toolCount: 1 }), now)).toBe("1 tool");
  });

  it("prefixes the elapsed clock when the start time is known", () => {
    const meta = subagentMeta(
      agent({ startedAt: "2026-01-01T00:00:00Z", toolCount: 2 }),
      now,
    );
    expect(meta).toBe("2m 10s · 2 tools");
  });

  it("stops a finished agent's clock at the moment it finished", () => {
    const meta = subagentMeta(
      agent({
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:00:30Z",
        toolCount: 2,
        done: true,
      }),
      // An hour later: the row still reports the 30s the agent actually took.
      now + 3_600_000,
    );
    expect(meta).toBe("0m 30s · 2 tools");
  });

  it("falls back to the live clock when the finish carried no timestamp", () => {
    const meta = subagentMeta(
      agent({ startedAt: "2026-01-01T00:00:00Z", toolCount: 2, done: true }),
      now,
    );
    expect(meta).toBe("2m 10s · 2 tools");
  });
});
