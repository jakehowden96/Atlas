import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import status from "../components/stats/codeburn/__fixtures__/status.json";
import sessions from "../components/stats/codeburn/__fixtures__/sessions.json";
import { filterArgs } from "../../types/codeburn";

const codeburn = vi.hoisted(() => vi.fn());
vi.mock("../stores/codeburn", () => ({ codeburn }));
import { monthCost, refreshCosts, sessionCosts, todayCost } from "../stores/cost";

beforeEach(() => {
  codeburn.mockReset();
});

describe("cost store", () => {
  it("parses status and sessions", async () => {
    codeburn.mockImplementation(async (args: string[]) =>
      args[0] === "status" ? status : args.includes("today") ? sessions.slice(0, 1) : sessions,
    );
    await refreshCosts();
    expect(get(todayCost)).toBe(18.06);
    expect(get(monthCost)).toBe(137.29);
    const costs = get(sessionCosts)!;
    const [first, second] = sessions as [(typeof sessions)[0], (typeof sessions)[0]];
    expect(costs.size).toBe(sessions.length);
    expect(costs.get(first.sessionId)).toEqual({ total: first.cost, today: first.cost });
    expect(costs.get(second.sessionId)?.today).toBe(0);
  });

  it("is null when codeburn fails", async () => {
    codeburn.mockRejectedValue(new Error("codeburn is not installed"));
    await refreshCosts();
    expect(get(todayCost)).toBeNull();
    expect(get(monthCost)).toBeNull();
    expect(get(sessionCosts)).toBeNull();
  });
});

describe("filterArgs", () => {
  const f = { period: "week", project: "app", provider: "claude" } as const;
  const range = { period: { from: "2026-10-01", to: "2026-10-31" } };

  it("emits every supported flag", () => {
    expect(filterArgs(f, "report")).toEqual([
      "--period",
      "week",
      "--project",
      "app",
      "--provider",
      "claude",
    ]);
    expect(filterArgs(range, "sessions")).toEqual(["--from", "2026-10-01", "--to", "2026-10-31"]);
  });

  it("respects per-command support", () => {
    expect(filterArgs(range, "yield")).toEqual([]);
    expect(filterArgs(f, "yield")).toEqual([
      "--period",
      "week",
      "--project",
      "app",
      "--provider",
      "claude",
    ]);
    expect(filterArgs(f, "compare-periods")).toEqual(["--project", "app", "--provider", "claude"]);
    expect(filterArgs(f, "plan")).toEqual(["--provider", "claude"]);
    expect(filterArgs(f, "quota")).toEqual([]);
  });
});
