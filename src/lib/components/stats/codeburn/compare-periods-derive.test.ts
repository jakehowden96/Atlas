import { describe, expect, it } from "vitest";
import { dayPairs, movers, presetRanges } from "./compare-periods-derive";

const row = (key: string, costA: number, costB: number, callsA = 10, callsB = 10) => ({
  key,
  costA,
  costB,
  diff: costB - costA,
  pct: null,
  status: "",
  callsA,
  callsB,
});

describe("compare-periods-derive", () => {
  it("builds adjacent 7-day windows", () => {
    expect(presetRanges(new Date(2026, 10, 9))).toEqual({
      a0: "2026-10-27",
      a1: "2026-11-02",
      b0: "2026-11-03",
      b1: "2026-11-09",
    });
  });
  it("sorts movers by absolute change and flags new rows", () => {
    const m = movers([row("x", 10, 11), row("y", 0, 5), row("z", 10, 2)], "raw", 7, 7);
    expect(m.map((r) => r.key)).toEqual(["z", "y", "x"]);
    expect(m[1]).toMatchObject({ isNew: true, pct: null });
    expect(m[0]?.pct).toBeCloseTo(-80);
  });
  it("normalises per day and per 100 calls", () => {
    expect(movers([row("x", 14, 7)], "day", 7, 7)[0]).toMatchObject({ a: 2, b: 1 });
    expect(movers([row("x", 5, 5, 10, 100)], "calls", 7, 7)[0]).toMatchObject({ a: 50, b: 5 });
  });
  it("pairs days by offset", () => {
    const p = dayPairs(
      { A: [{ date: "2026-01-01", cost: 1 }], B: [{ date: "2026-01-11", cost: 2 }] },
      "2026-01-01",
      "2026-01-10",
      2,
    );
    expect(p).toEqual([
      { i: 0, a: 1, b: 0 },
      { i: 1, a: 0, b: 2 },
    ]);
  });
});
