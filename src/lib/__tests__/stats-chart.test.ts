import { describe, expect, it } from "vitest";
import {
  deltaText,
  formatValue,
  heatLegend,
  heatStep,
  medianText,
  niceTicks,
  toCsv,
  visibleLabels,
} from "../stats-chart";

describe("stats-chart helpers", () => {
  it("niceTicks starts at 0, covers max, and has few gridlines", () => {
    expect(niceTicks(18.4)).toEqual([0, 10, 20]);
    expect(niceTicks(11)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(0)).toEqual([0, 1]);
    for (const m of [1, 7, 37, 260, 9999]) {
      const t = niceTicks(m);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(m);
      expect(t.length).toBeLessThanOrEqual(5);
    }
  });

  it("formats units", () => {
    expect(formatValue(10, "usd", true)).toBe("$10");
    expect(formatValue(18.4, "usd")).toBe("$18.40");
    expect(formatValue(1500, "tokens")).toBe("1.5k tokens");
    expect(formatValue(6, "count")).toBe("6");
  });

  it("thins x labels", () => {
    expect([...visibleLabels(7)]).toHaveLength(7);
    expect([...visibleLabels(30)]).toEqual([0, 14, 29]);
  });

  it("heat steps and legend", () => {
    expect([0, 1, 3, 5, 8].map((v) => heatStep(v, 8))).toEqual([0, 1, 2, 3, 4]);
    expect(heatLegend(8)).toEqual(["0", "1+", "3+", "5+", "7+"]);
  });

  it("median and delta text", () => {
    expect(medianText(20, [5, 10, 20])).toBe("2.0× the median");
    expect(medianText(1, [0, 0])).toBe("");
    expect(deltaText(12.4, "last week")).toBe("+12% vs last week");
    expect(deltaText(-5, "last week")).toBe("−5% vs last week");
  });

  it("toCsv quotes", () => {
    expect(toCsv([["a,b", 1]])).toBe('"a,b",1');
  });
});
