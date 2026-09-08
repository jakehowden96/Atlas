import { describe, expect, it } from "vitest";
import type { DayStats, ModelStats, StatsSummary } from "../../types/stats";
import {
  agoLabel,
  basename,
  daySeries,
  delta,
  deltaLabel,
  deltaTone,
  modelRows,
  peakDay,
  projectRows,
  recentForRange,
  recentWeeks,
  sortedModels,
  sparkSeries,
  toolRows,
  totalsForRange,
  weekFamilies,
  weekLabel,
} from "../stats-derive";

function day(over: Partial<DayStats> = {}): DayStats {
  return {
    sessions: 0,
    outputTokens: 0,
    userMessages: 0,
    cost: 0,
    peakContext: 0,
    subagents: 0,
    ...over,
  };
}

function model(over: Partial<ModelStats> = {}): ModelStats {
  return {
    sessions: 0,
    assistantMsgs: 0,
    userMessages: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cost: 0,
    toolCalls: 0,
    toolErrors: 0,
    totalDurationSecs: 0,
    totalSubagents: 0,
    peakContextMax: 0,
    userChars: 0,
    msgsPerSession: 0,
    toolsPerSession: 0,
    errorRate: 0,
    costPerSession: 0,
    outputPerSession: 0,
    avgDurationSecs: 0,
    avgMessageChars: 0,
    subagentsPerSession: 0,
    avgOutputPerMsg: 0,
    costPerKOutput: 0,
    subagentPromptChars: 0,
    subagentPromptCount: 0,
    avgSubagentPromptChars: 0,
    ...over,
  };
}

function summary(over: Partial<StatsSummary> = {}): StatsSummary {
  const zero = { sessions: 0, userMessages: 0, outputTokens: 0, cost: 0, peakContext: 0, subagents: 0 };
  return {
    totalSessions: 0,
    totalUserMessages: 0,
    totalAssistantMessages: 0,
    peakContextOverall: 0,
    avgPeakContext: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCostEstimate: 0,
    totalToolErrors: 0,
    totalSubagents: 0,
    errorRate: 0,
    byModel: {},
    byModel30d: {},
    byModel7d: {},
    byModelSubagents: {},
    byModelSubagents30d: {},
    byModelSubagents7d: {},
    toolUsage: {},
    toolErrors: {},
    toolUsage30d: {},
    toolErrors30d: {},
    toolUsage7d: {},
    toolErrors7d: {},
    byProject: {},
    byProject30d: {},
    byProject7d: {},
    byDay: {},
    byWeek: {},
    recentSessions: [],
    totalsAll: { ...zero },
    totals30d: { ...zero },
    totalsPrev30d: { ...zero },
    totals7d: { ...zero },
    totalsPrev7d: { ...zero },
    versions: [],
    generatedAt: "2026-09-08T00:00:00Z",
    ...over,
  };
}

describe("delta", () => {
  it("is blank for all time, which has no previous period", () => {
    const d = delta(10, null);
    expect(d.kind).toBe("none");
    expect(deltaLabel(d)).toBe("");
  });

  it("flips sign between growth and decline", () => {
    expect(deltaLabel(delta(12, 10))).toBe("+20%");
    expect(deltaTone(delta(12, 10))).toBe("up");
    expect(deltaLabel(delta(8, 10))).toBe("-20%");
    expect(deltaTone(delta(8, 10))).toBe("down");
  });

  it("reads zero as flat, not as a rise", () => {
    expect(deltaLabel(delta(10, 10))).toBe("0%");
    expect(deltaTone(delta(10, 10))).toBe("flat");
  });

  it("says 'new' rather than dividing by an empty previous window", () => {
    // Real case: 11 sessions in the last 30 days, none in the 30 before that.
    expect(deltaLabel(delta(11, 0))).toBe("new");
    expect(deltaTone(delta(11, 0))).toBe("up");
    expect(deltaLabel(delta(0, 0))).toBe("0%");
  });
});

describe("range selection", () => {
  const s = summary({
    totals7d: { sessions: 5, userMessages: 20, outputTokens: 100, cost: 46.1, peakContext: 9, subagents: 2 },
    totalsPrev7d: { sessions: 3, userMessages: 9, outputTokens: 50, cost: 28.58, peakContext: 7, subagents: 1 },
    totals30d: { sessions: 11, userMessages: 62, outputTokens: 900, cost: 91.75, peakContext: 12, subagents: 11 },
    totalsPrev30d: { sessions: 0, userMessages: 0, outputTokens: 0, cost: 0, peakContext: 0, subagents: 0 },
    totalsAll: { sessions: 11, userMessages: 62, outputTokens: 900, cost: 91.75, peakContext: 12, subagents: 11 },
    toolUsage: { Bash: 411, PowerShell: 133, Read: 37 },
    toolErrors: { Bash: 14, PowerShell: 14 },
    toolUsage7d: { Bash: 100 },
    toolErrors7d: { Bash: 1 },
    byProject: { "/repo/a": { sessions: 2, outputTokens: 10, userMessages: 3, cost: 36.7, subagents: 11 } },
    byProject7d: {},
  });

  it("pairs each window with the one immediately before it", () => {
    expect(totalsForRange(s, "7d").previous?.sessions).toBe(3);
    expect(totalsForRange(s, "30d").previous?.sessions).toBe(0);
    expect(totalsForRange(s, "all").previous).toBeNull();
    expect(totalsForRange(s, "all").current.cost).toBeCloseTo(91.75);
  });

  it("windows the tools list, busiest first, with a per-tool error rate", () => {
    const all = toolRows(s, "all");
    expect(all.map((t) => t.name)).toEqual(["Bash", "PowerShell", "Read"]);
    expect(all[0].errorPct).toBeCloseTo((14 / 411) * 100);
    expect(all[1].errorPct).toBeCloseTo((14 / 133) * 100);
    expect(all[2].errorPct).toBe(0);

    const week = toolRows(s, "7d");
    expect(week).toHaveLength(1);
    expect(week[0].errorPct).toBeCloseTo(1);
  });

  it("windows the workspace table too, not just the model tables", () => {
    expect(projectRows(s, "all")).toHaveLength(1);
    expect(projectRows(s, "all")[0][1].cost).toBeCloseTo(36.7);
    expect(projectRows(s, "7d")).toHaveLength(0);
  });

  it("trims recent sessions to the window", () => {
    const now = new Date("2026-09-08T00:00:00Z");
    const withSessions = summary({
      recentSessions: [
        session("fresh", "2026-09-07T00:00:00Z"),
        session("older", "2026-08-20T00:00:00Z"),
        session("ancient", "2025-01-01T00:00:00Z"),
      ],
    });
    expect(recentForRange(withSessions, "7d", now).map((r) => r.sessionId)).toEqual(["fresh"]);
    expect(recentForRange(withSessions, "30d", now).map((r) => r.sessionId)).toEqual([
      "fresh",
      "older",
    ]);
    expect(recentForRange(withSessions, "all", now)).toHaveLength(3);
  });
});

function session(id: string, ts: string) {
  return {
    sessionId: id,
    title: null,
    cwd: "/repo/a",
    gitBranch: null,
    model: "Opus",
    lastTimestamp: ts,
    durationSecs: 60,
    outputTokens: 10,
    costEstimate: 1,
  };
}

describe("day series", () => {
  const byDay = {
    "2026-09-01": day({ sessions: 2, cost: 4 }),
    "2026-09-05": day({ sessions: 9, cost: 12 }),
    "2026-09-08": day({ sessions: 1, cost: 2 }),
  };
  const today = new Date("2026-09-08T13:00:00Z");

  it("fills gaps with zeroes and ends on today", () => {
    const week = daySeries(byDay, today, 7);
    expect(week).toHaveLength(7);
    expect(week[0].date).toBe("2026-09-02");
    expect(week[week.length - 1].date).toBe("2026-09-08");
    expect(week[week.length - 1].stats.sessions).toBe(1);
    expect(week[0].stats.sessions).toBe(0);
  });

  it("finds the busiest day for the heatmap caption", () => {
    const peak = peakDay(daySeries(byDay, today, 30));
    expect(peak?.date).toBe("2026-09-05");
    expect(peak?.stats.sessions).toBe(9);
    expect(peakDay(daySeries({}, today, 30))).toBeNull();
  });

  it("runs all-time sparklines from the first recorded day to today", () => {
    const all = sparkSeries(byDay, "all", today);
    expect(all[0].date).toBe("2026-09-01");
    expect(all[all.length - 1].date).toBe("2026-09-08");
    expect(all).toHaveLength(8);
    expect(sparkSeries(byDay, "7d", today)).toHaveLength(7);
    expect(sparkSeries({}, "all", today)).toHaveLength(0);
  });
});

describe("model table", () => {
  it("orders families Opus, Fable, Sonnet, Haiku and keeps unknowns last", () => {
    const ordered = sortedModels({
      Haiku: model(),
      "some-future-model": model(),
      Opus: model(),
      Sonnet: model(),
    });
    expect(ordered.map(([f]) => f)).toEqual(["Opus", "Sonnet", "Haiku", "some-future-model"]);
  });

  it("renders the ten design rows straight off ModelStats", () => {
    const rows = modelRows([
      [
        "Opus",
        model({
          sessions: 2,
          outputTokens: 254_459,
          cost: 36.7,
          avgDurationSecs: 3600,
          toolsPerSession: 41.25,
          errorRate: 0.021,
          subagentsPerSession: 5.5,
          costPerKOutput: 0.144,
          peakContextMax: 445_611,
          avgMessageChars: 411.6,
        }),
      ],
    ]);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.label)).toEqual([
      "Sessions",
      "Output tokens",
      "Est. cost",
      "Avg session",
      "Tools / session",
      "Error rate",
      "Subagents / session",
      "Cost / 1K output",
      "Peak context",
      "Avg message length",
    ]);
    expect(rows[1].values).toEqual(["254K"]);
    expect(rows[2].values).toEqual(["$36.70"]);
    expect(rows[3].values).toEqual(["1h 0m"]);
    expect(rows[5].values).toEqual(["2.1%"]);
    expect(rows[8].values).toEqual(["446K"]);
    expect(rows[9].values).toEqual(["412 chars"]);
  });
});

describe("weeks", () => {
  const byWeek = {
    "2026-W30": { sessions: 1, byModel: { Sonnet: 1 }, byModelSubagents: {} },
    "2026-W36": { sessions: 4, byModel: { Opus: 4 }, byModelSubagents: { Opus: 11 } },
    "2026-W37": { sessions: 2, byModel: { Opus: 2 }, byModelSubagents: {} },
  };

  it("keeps the newest weeks, oldest first", () => {
    expect(recentWeeks(byWeek, 2).map(([k]) => k)).toEqual(["2026-W36", "2026-W37"]);
    expect(recentWeeks(byWeek, 8).map(([k]) => k)).toEqual(["2026-W30", "2026-W36", "2026-W37"]);
  });

  it("collects the families to stack, in display order", () => {
    expect(weekFamilies(recentWeeks(byWeek, 8))).toEqual(["Opus", "Sonnet"]);
  });

  it("labels a week by its Monday", () => {
    expect(weekLabel("2026-W36")).toBe("31 Aug");
    expect(weekLabel("nonsense")).toBe("nonsense");
  });
});

describe("small formatters", () => {
  it("takes the last segment of a path on either separator", () => {
    expect(basename("C:\\Users\\jakeh\\Documents\\GitHub\\Atlas")).toBe("Atlas");
    expect(basename("/home/j/repos/atlas/")).toBe("atlas");
    expect(basename("atlas")).toBe("atlas");
  });

  it("counts back from the generated-at stamp", () => {
    const now = new Date("2026-09-08T00:01:00Z");
    expect(agoLabel("2026-09-08T00:00:48Z", now)).toBe("12s ago");
    expect(agoLabel("2026-09-07T23:00:00Z", now)).toBe("1h ago");
    expect(agoLabel("not a date", now)).toBe("just now");
  });
});
