import { describe, expect, it } from "vitest";
import type { Yield } from "../../../../types/codeburn-yield";
import { yieldCosts } from "./yield-derive";

const b = { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 };
const y = (commits: number[], productive: number): Yield => ({
  period: { label: "x" },
  summary: {
    productive: { ...b, sessions: productive },
    reverted: b,
    abandoned: b,
    ambiguous: b,
    total: { costUSD: 10, sessions: 5 },
  },
  details: commits.map((commitCount, i) => ({
    sessionId: String(i),
    project: "p",
    costUSD: 1,
    category: "productive",
    commitCount,
  })),
});

describe("yieldCosts", () => {
  it("divides total spend", () => {
    expect(yieldCosts(y([3, 2], 2))).toEqual({ perCommit: 2, perProductive: 5 });
  });
  it("returns null with no commits or productive sessions", () => {
    expect(yieldCosts(y([], 0))).toEqual({ perCommit: null, perProductive: null });
  });
});
