import { describe, expect, it } from "vitest";
import type { ModelRow } from "../../../../types/codeburn-models";
import { byCostDesc, cacheHit, isUnpriced } from "./models-derive";

const row = (o: Partial<ModelRow>): ModelRow => ({
  model: "m",
  savingsUSD: 0,
  modelDisplayName: "m",
  providerDisplayName: "p",
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  calls: 0,
  costUSD: 0,
  isEstimated: false,
  ...o,
});

describe("models-derive", () => {
  it("computes cache hit and handles zero", () => {
    expect(cacheHit(row({ inputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 10 }))).toBe(80);
    expect(cacheHit(row({}))).toBe(0);
  });
  it("flags unpriced rows", () => {
    expect(isUnpriced(row({ calls: 3 }))).toBe(true);
    expect(isUnpriced(row({ calls: 3, costUSD: 1 }))).toBe(false);
  });
  it("sorts by cost without mutating", () => {
    const a = [row({ costUSD: 1 }), row({ costUSD: 5 })];
    expect(byCostDesc(a)[0]?.costUSD).toBe(5);
    expect(a[0]?.costUSD).toBe(1);
  });
});
