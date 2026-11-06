import { describe, expect, it } from "vitest";
import { fmtCost, fmtTokens, localDayKey } from "../stats-derive";

describe("fmtCost", () => {
  it("formats consistently", () => {
    expect(fmtCost(18.76)).toBe("$18.76");
    expect(fmtCost(1234.5)).toBe("$1,234.50");
    expect(fmtCost(0.5)).toBe("$0.500");
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
