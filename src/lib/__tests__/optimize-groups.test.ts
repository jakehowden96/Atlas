import { describe, expect, it } from "vitest";
import type { Finding } from "../../types/codeburn-optimize";
import { groupFindings } from "../components/stats/codeburn/optimize-groups";

const f = (id: string, cls: Finding["class"], usd: number) =>
  ({ id, class: cls, estimatedSavingsUSD: usd }) as Finding;

describe("groupFindings", () => {
  it("groups, sorts by saving and drops empty groups", () => {
    const g = groupFindings([f("a", "nudge", 1), f("b", "fix", 1), f("c", "fix", 5)]);
    expect(g.map((x) => x.title)).toEqual(["Fix now", "Habits"]);
    expect(g[0]?.items.map((x) => x.id)).toEqual(["c", "b"]);
  });
  it("handles none", () => expect(groupFindings([])).toEqual([]));
});
