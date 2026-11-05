import { describe, expect, it } from "vitest";
import type { SessionRow } from "../../types/codeburn-sessions";
import { sortSessions, topCategory } from "../components/stats/codeburn/sessions-sort";

const row = (o: Partial<SessionRow>) => ({ title: "", cost: 0, ...o }) as SessionRow;

describe("sessions-sort", () => {
  it("sorts by number and string without mutating", () => {
    const rows = [row({ title: "b", cost: 1 }), row({ title: "a", cost: 3 })];
    expect(sortSessions(rows, "cost", true).map((r) => r.cost)).toEqual([3, 1]);
    expect(sortSessions(rows, "title", false).map((r) => r.title)).toEqual(["a", "b"]);
    expect(rows[0]?.title).toBe("b");
  });
  it("topCategory handles missing contributions", () => {
    expect(topCategory(row({}))).toBe("");
    const segments = [
      { day: "d", category: "x", cost: 1 },
      { day: "d", category: "y", cost: 2 },
      { day: "e", category: "x", cost: 2 },
    ];
    expect(topCategory(row({ contributions: { segments } }))).toBe("x");
  });
});
