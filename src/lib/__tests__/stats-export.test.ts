import { describe, expect, it } from "vitest";
import {
  exportCsv,
  exportJson,
  filterByBucket,
  isoWeekKey,
  sortRecent,
  type Bucket,
  type ExportData,
} from "../stats-export";
import type { RecentSession } from "../../types/generated/RecentSession";

const session = (over: Partial<RecentSession>): RecentSession => ({
  sessionId: "s1",
  title: "t",
  cwd: "C:\\Work\\Atlas",
  gitBranch: null,
  model: "Opus",
  lastTimestamp: "2026-09-08T12:00:00Z",
  durationSecs: 60,
  outputTokens: 1000,
  costEstimate: 0.5,
  ...over,
});

const data = (sessions: RecentSession[]): ExportData => ({
  range: "7d",
  generatedAt: "2026-09-08T12:00:00Z",
  totals: {},
  models: [],
  tools: [{ name: 'Bash, "quoted"', calls: 12_345_678_901, errors: 2 }],
  workspaces: [{ path: "C:\\a", sessions: 1, outputTokens: 5, cost: 0.0123 }],
  weeks: [{ week: "2026-W37", sessions: 3 }],
  days: [{ date: "2026-09-08", sessions: 2 }],
  sessions,
});

describe("stats export", () => {
  it("quotes commas, quotes and newlines and keeps raw units", () => {
    const csv = exportCsv(data([session({ title: 'a,b\n"c"' })]));
    expect(csv.split("\n")[0]).toBe("section,name,metric,value");
    expect(csv).toContain('tool,"Bash, ""quoted""",calls,12345678901');
    expect(csv).toContain('session,"a,b\n""c""",cost,0.5');
    expect(csv).toContain("workspace,C:\\a,cost,0.0123");
    expect(csv).toContain(",lastTimestamp,2026-09-08T12:00:00Z");
  });

  it("orders sections tools, workspaces, weeks, days, sessions", () => {
    const csv = exportCsv(data([session({})]));
    const at = ["tool,", "workspace,", "week,", "day,", "session,"].map((p) => csv.indexOf(`\n${p}`));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at.every((i) => i > 0)).toBe(true);
  });

  it("JSON keeps ISO dates and large numbers", () => {
    const parsed = JSON.parse(exportJson(data([session({})])));
    expect(parsed.sessions[0].lastTimestamp).toBe("2026-09-08T12:00:00Z");
    expect(parsed.tools[0].calls).toBe(12_345_678_901);
  });
});

describe("recent sessions table", () => {
  const list = [
    session({ sessionId: "a", outputTokens: 5, title: null }),
    session({ sessionId: "b", outputTokens: 9, title: "Zed" }),
    session({ sessionId: "c", outputTokens: 9, title: "Alpha" }),
  ];
  const ids = (l: RecentSession[]) => l.map((s) => s.sessionId);

  it("sorts numbers both ways with a stable tiebreak", () => {
    expect(ids(sortRecent(list, "outputTokens", true))).toEqual(["b", "c", "a"]);
    expect(ids(sortRecent(list, "outputTokens", false))).toEqual(["a", "b", "c"]);
  });

  it("sorts text and tolerates nulls", () => {
    expect(ids(sortRecent(list, "title", false))).toEqual(["a", "c", "b"]);
  });

  it("computes ISO weeks", () => {
    expect(isoWeekKey(new Date(2026, 8, 8))).toBe("2026-W37");
    expect(isoWeekKey(new Date(2026, 0, 1))).toBe("2026-W01");
  });

  it("filters by day, week, workspace and model", () => {
    const l = [
      session({ sessionId: "a", lastTimestamp: new Date(2026, 8, 8, 12).toISOString() }),
      session({
        sessionId: "b",
        lastTimestamp: new Date(2026, 8, 1, 12).toISOString(),
        cwd: "c:/work/atlas/",
        model: "Haiku",
      }),
      session({ sessionId: "c", lastTimestamp: null, cwd: null }),
    ];
    const f = (b: Bucket | null) => ids(filterByBucket(l, b));
    expect(f(null)).toEqual(["a", "b", "c"]);
    expect(f({ kind: "day", key: "2026-09-08", label: "" })).toEqual(["a"]);
    expect(f({ kind: "week", key: "2026-W36", label: "" })).toEqual(["b"]);
    expect(f({ kind: "workspace", key: "C:\\Work\\Atlas", label: "" })).toEqual(["a", "b"]);
    expect(f({ kind: "model", key: "Haiku", label: "" })).toEqual(["b"]);
  });
});
