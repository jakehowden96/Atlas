import { describe, expect, it } from "vitest";
import type { DayStats } from "../../types/generated/DayStats";
import type { StatsSummary } from "../../types/generated/StatsSummary";
import { costTodayLine, fmtCost, fmtTokens, localDayKey, todayCost } from "../stats-derive";

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
function summary(over: Partial<StatsSummary> = {}): StatsSummary {
  const zero = {
    sessions: 0,
    userMessages: 0,
    outputTokens: 0,
    cost: 0,
    peakContext: 0,
    subagents: 0,
  };
  return {
    byModel: {},
    byModel30d: {},
    byModel7d: {},
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
    generatedAt: "2026-09-08T00:00:00Z",
    ...over,
  };
}

describe("todayCost", () => {
  const now = new Date(2026, 8, 9, 14, 0, 0);

  /* Spend is booked per local day by the backend, so a conversation resumed
     today adds today's turns, not the whole multi-day cost it has accrued. */
  it("reads the cost booked on today's local day", () => {
    const s = summary({
      byDay: {
        [localDayKey(now)]: day({ sessions: 1, cost: 3.5 }),
        "2026-09-08": day({ sessions: 4, cost: 40 }),
      },
    });
    expect(todayCost(s, now)).toBeCloseTo(3.5);
  });

  it("is zero on a day with no activity, and with no stats loaded", () => {
    expect(todayCost(summary({ byDay: { "2026-09-08": day({ cost: 9 }) } }), now)).toBe(0);
    expect(todayCost(null, now)).toBe(0);
  });
});

describe("fmtCost / costTodayLine", () => {
  it("formats consistently", () => {
    expect(fmtCost(18.76)).toBe("$18.76");
    expect(fmtCost(1234.5)).toBe("$1,234.50");
    expect(fmtCost(0.5)).toBe("$0.500");
  });

  it("shows a today line only when the session spans days", () => {
    expect(costTodayLine({ costEstimate: 18.76, costToday: 8.1 })).toBe("$8.10 today");
    expect(costTodayLine({ costEstimate: 3, costToday: 3 })).toBeNull();
  });
});

describe("localDayKey", () => {
  it("is the local calendar date, zero padded", () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDayKey(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});

describe("fmtTokens", () => {
  it("moves to millions when rounding would print 1000K", () => {
    expect(fmtTokens(999_600)).toBe("1.0M");
    expect(fmtTokens(999_400)).toBe("999K");
    expect(fmtTokens(1_500_000)).toBe("1.5M");
    expect(fmtTokens(12)).toBe("12");
  });
});
