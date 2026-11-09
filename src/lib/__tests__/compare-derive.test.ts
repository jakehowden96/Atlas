import { describe, expect, it } from "vitest";
import type { ModelCompareRow } from "../../types/codeburn-compare";
import { cohortRows, modelStats, shortKey, verdict, win } from "../components/stats/codeburn/compare-derive";

const row = (o: Partial<ModelCompareRow>): ModelCompareRow => ({
  model: "m",
  calls: 0,
  cost: 0,
  outputTokens: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTurns: 0,
  editTurns: 0,
  oneShotTurns: 0,
  retries: 0,
  selfCorrections: 0,
  editCost: 0,
  firstSeen: "",
  lastSeen: "",
  ...o,
});

describe("modelStats", () => {
  it("sorts by cost and guards zero divisors", () => {
    const s = modelStats([
      row({ model: "a", cost: 1 }),
      row({ model: "b", cost: 4, calls: 2, editTurns: 4, oneShotTurns: 3 }),
    ]);
    expect(s.map((x) => x.model)).toEqual(["b", "a"]);
    expect(s[0]?.costPerCall).toBe(2);
    expect(s[0]?.oneShotRate).toBe(0.75);
    expect(s[1]?.costPerCall).toBe(0);
    expect(s[1]?.oneShotRate).toBeNull();
  });
});

describe("win", () => {
  it("highlights the better side, never ties or missing data", () => {
    expect(win(1, 2, -1)).toBe(1);
    expect(win(1, 2, 1)).toBe(-1);
    expect(win(2, 2, 1)).toBe(0);
    expect(win(null, 2, 1)).toBe(0);
  });
});

describe("verdict", () => {
  it("names the cheaper model and the one-shot gap", () => {
    const a = row({ model: "a", editTurns: 10, oneShotTurns: 9, editCost: 10 });
    const b = row({ model: "b", editTurns: 10, oneShotTurns: 5, editCost: 30 });
    expect(verdict(a, b)).toBe("a is 3.0x cheaper per edit and 40 pts higher on one-shot.");
    expect(verdict(row({}), b)).toBeNull();
  });
});

describe("cohortRows", () => {
  it("pairs groups and keeps missing sides empty", () => {
    const o = (category: string, oneShot: boolean) => ({
      project: "p",
      category,
      costUSD: 2,
      costKnown: true,
      oneShot,
    });
    const rows = cohortRows([o("x", true), o("x", false)], [o("y", true)], "category");
    expect(rows[0]).toMatchObject({ key: "x", minN: 0, a: { n: 2, rate: 50, cost: 2 }, b: { n: 0, rate: null } });
    expect(rows[1]?.a.rate).toBeNull();
  });
});

describe("shortKey", () => {
  it("takes the last segment", () => {
    expect(shortKey("e:/github/atlas/.claude/worktrees/agent-1")).toBe("agent-1");
  });
});
