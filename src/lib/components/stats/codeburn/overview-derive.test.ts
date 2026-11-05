import { describe, expect, it } from "vitest";
import type { Overview, Timeline } from "../../../../types/codeburn";
import { activityCells, efficiencyRows, fmtMs, trend } from "./overview-derive";

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
    const o = { history: { daily: [{ date: "2026-10-06", cost: 3, calls: 9 }], timeline: tl } };
    const cells = activityCells(o as unknown as Overview);
    expect(cells.map((c) => c.key.startsWith("pad"))).toEqual([true, false, false]);
    expect(cells[1]?.value).toBe(9);
    expect(activityCells({ history: { daily: [] } } as unknown as Overview)).toEqual([]);
  });

  it("turns retry tax and routing waste into shares of spend, zero-safe", () => {
    const c = {
      cost: 100,
      cacheHitPercent: 99,
      oneShotRate: 0.8,
      retryTax: { totalUSD: 20 },
      routingWaste: { totalSavingsUSD: 5 },
    } as unknown as Overview["current"];
    expect(efficiencyRows(c).map((r) => r.pct)).toEqual([99, 80, 20, 5]);
    expect(efficiencyRows({ ...c, cost: 0 })[2]?.pct).toBe(0);
  });

  it("formats the first-edit time", () => {
    expect(fmtMs(26_000)).toBe("26s");
    expect(fmtMs(317_483)).toBe("5m 17s");
  });
});
