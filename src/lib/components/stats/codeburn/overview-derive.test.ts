import { describe, expect, it } from "vitest";
import type { Overview, Timeline } from "../../../../types/codeburn";
import {
  activityCells,
  efficiencyRows,
  fmtMs,
  fmtPct,
  monthCumulative,
  monthWindows,
  pace,
  trend,
  weekWindows,
} from "./overview-derive";

const tl: Timeline = {
  bucketMinutes: 1440,
  modelSeries: [
    { id: "a", label: "claude-opus-5-5" },
    { id: "b", label: "claude-opus-5" },
    { id: "c", label: "claude-haiku-5-5" },
    { id: "d", label: "unused" },
  ],
  points: [
    {
      timestamp: "2026-10-06T12:00:00.000Z",
      cost: 3,
      tokens: 30,
      models: [
        { seriesId: "a", cost: 1, tokens: 10 },
        { seriesId: "b", cost: 2, tokens: 20 },
      ],
    },
    { timestamp: "2026-10-07T12:00:00.000Z", cost: 0, tokens: 0, models: [] },
  ],
};

describe("overview-derive", () => {
  it("drops unused series, orders by total and tints a second model of one family", () => {
    const { days, series } = trend(tl, "cost");
    expect(series.map((s) => s.id)).toEqual(["b", "a"]);
    expect(series[0]?.color).toBe("var(--model-opus)");
    expect(series[1]?.color).toContain("color-mix");
    expect(days[0]?.total).toBe(3);
    expect(trend(undefined, "cost").days).toEqual([]);
  });

  it("switches the trend to tokens", () => {
    expect(trend(tl, "tokens").days[0]?.total).toBe(30);
  });

  it("pads the first day onto its Monday-first row", () => {
    // 2026-10-06 is a Tuesday: one pad cell, then two days.
    const o = { history: { daily: [{ date: "2026-10-06", cost: 3, calls: 9 }] } };
    const cells = activityCells(o as unknown as Overview, new Date(2026, 9, 7, 12));
    expect(cells.map((c) => c.key.startsWith("pad"))).toEqual([true, false, false]);
    expect(cells[1]?.value).toBe(9);
    expect(activityCells({ history: { daily: [] } } as unknown as Overview)).toEqual([]);
  });

  it("caps the grid at the window, 20 Monday-first weeks", () => {
    const o = { history: { daily: [{ date: "2020-01-01", cost: 1, calls: 1 }] } };
    const cells = activityCells(o as unknown as Overview, new Date(2026, 10, 5)); // a Thursday
    expect(cells.length).toBe(19 * 7 + 4);
  });

  it("builds compare windows and the month's running total", () => {
    expect(monthWindows(new Date(2026, 2, 31))).toEqual([
      ...["--from-a", "2026-02-01", "--to-a", "2026-02-28"],
      ...["--from-b", "2026-03-01", "--to-b", "2026-03-31"],
    ]);
    expect(weekWindows(new Date(2026, 10, 10))[1]).toBe("2026-10-28");
    expect(
      monthCumulative(
        [
          { date: "2026-11-01", cost: 2 },
          { date: "2026-11-03", cost: 1 },
        ],
        new Date(2026, 10, 3),
      ),
    ).toEqual([2, 2, 3]);
  });

  it("turns retry tax and routing waste into shares of spend, zero-safe", () => {
    const c = {
      cost: 100,
      cacheHitPercent: 99,
      oneShotRate: 0.8,
      retryTax: { totalUSD: 20 },
      routingWaste: { totalSavingsUSD: 5 },
    } as unknown as Overview["current"];
    expect(efficiencyRows(c).map((r) => r.pct)).toEqual([80, 99, 20]);
    expect(efficiencyRows({ ...c, cost: 0 })[2]?.pct).toBe(0);
  });

  it("formats the first-edit time", () => {
    expect(fmtMs(26_000)).toBe("26s");
    expect(fmtMs(317_483)).toBe("5m 17s");
  });
});

describe("pace", () => {
  const now = new Date(2026, 10, 10, 12); // 10 Nov 2026
  const day = (n: number, cost: number) => ({
    date: `2026-11-${String(n).padStart(2, "0")}`,
    cost,
  });

  it("derives yesterday, 7-day mean, projection and vs-mean", () => {
    const daily = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => day(n, 10)).concat(day(10, 15));
    const p = pace(daily, 100, now);
    expect(p.yesterday).toBe(10);
    expect(p.avg7).toBe(10);
    expect(p.projected).toBe(300); // 100 / 10 days * 30
    expect(p.vsYesterdayPct).toBe(50);
  });

  it("is null where the data does not reach back", () => {
    const p = pace([day(10, 5)], null, now);
    expect(p.yesterday).toBeNull();
    expect(p.avg7).toBeNull();
    expect(p.projected).toBeNull();
    expect(p.vsYesterdayPct).toBeNull();
  });

  it("formats percent", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(12.4)).toBe("+12%");
    expect(fmtPct(-3)).toBe("-3%");
  });
});
