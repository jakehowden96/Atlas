import { describe, expect, it } from "vitest";
import type { ModelCompareRow } from "../../types/codeburn-compare";
import { modelStats, shortKey } from "../components/stats/codeburn/compare-derive";

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

describe("shortKey", () => {
  it("takes the last segment", () => {
    expect(shortKey("e:/github/atlas/.claude/worktrees/agent-1")).toBe("agent-1");
  });
});
