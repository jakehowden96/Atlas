import { describe, expect, it } from "vitest";
import { costTodayLine, localDayKey, todayCost } from "../stats-derive";

// Issue #35 scenario: a session at $18.76 lifetime, $8.10 of it booked today,
// next to a second session begun today. Day totals come from the same records.
const now = new Date(2026, 8, 9, 12, 0, 0);
const today = localDayKey(now);
const yesterday = localDayKey(new Date(2026, 8, 8, 12, 0, 0));

const sessions = [
  { id: "multi-day", costEstimate: 18.76, costToday: 8.1 },
  { id: "today-only", costEstimate: 0.52, costToday: 0.52 },
];
const byDay: Record<string, { cost: number }> = {
  [yesterday]: { cost: 10.66 },
  [today]: { cost: 8.62 },
};
// biome-ignore lint/suspicious/noExplicitAny: partial fixture
const summary = { byDay, totalsAll: { cost: 19.28 } } as any;

describe("cost consistency", () => {
  it("top bar today equals byDay[today].cost", () => {
    expect(todayCost(summary, now)).toBe(byDay[today]?.cost);
  });

  it("sum of session costs equals the all-time total", () => {
    const sum = sessions.reduce((a, s) => a + s.costEstimate, 0);
    expect(sum, `sessions ${sum} vs all-time ${summary.totalsAll.cost}`).toBeCloseTo(summary.totalsAll.cost, 2);
  });

  it("no session's cost_today exceeds the top bar today value", () => {
    const top = todayCost(summary, now);
    for (const s of sessions) expect(s.costToday, `${s.id}: ${s.costToday} > ${top}`).toBeLessThanOrEqual(top);
  });

  it("a session whose total exceeds today shows a today line", () => {
    const top = todayCost(summary, now);
    for (const s of sessions) {
      if (s.costEstimate > top) expect(costTodayLine(s), `${s.id}: ${s.costEstimate} > ${top}`).not.toBeNull();
    }
    expect(costTodayLine(sessions[0] as (typeof sessions)[number])).toBe("$8.10 today");
  });
});
