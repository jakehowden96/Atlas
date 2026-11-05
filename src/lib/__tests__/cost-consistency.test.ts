// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import status from "../components/stats/codeburn/__fixtures__/status.json";
import sessions from "../components/stats/codeburn/__fixtures__/sessions.json";
import { costTodayLine, fmtCost } from "../format-cost";

const codeburn = vi.hoisted(() => vi.fn());
vi.mock("../stores/codeburn", () => ({ codeburn }));
vi.mock("../ipc", () => ({}));
import MeterStrip from "../components/session/rail/MeterStrip.svelte";
import { refreshCosts, sessionCosts, todayCost } from "../stores/cost";
import type { LiveSession } from "../../types/generated/LiveSession";

// One codeburn answer feeds the top bar, the tiles and the rail.
codeburn.mockImplementation(async (args: string[]) =>
  args[0] === "status" ? status : args.includes("today") ? sessions.slice(0, 1) : sessions,
);

describe("one cost everywhere", () => {
  it("top bar today equals status.today.cost", async () => {
    await refreshCosts();
    expect(get(todayCost)).toBe(status.today.cost);
  });

  it("session today values never exceed the top bar", async () => {
    await refreshCosts();
    const sum = [...get(sessionCosts)!.values()].reduce((a, c) => a + c.today, 0);
    expect(sum).toBeLessThanOrEqual(get(todayCost)!);
  });

  it("rail shows the store's value for the session, and a dash without an entry", async () => {
    await refreshCosts();
    const s = sessions[0]!;
    const entry = get(sessionCosts)!.get(s.sessionId)!;
    const now = Date.parse("2026-01-01T00:48:12Z");
    const base = { contextPct: 0.5, model: "claude-sonnet-4-5", startedAt: "2026-01-01T00:00:00Z" };
    const { unmount } = render(MeterStrip, {
      live: { ...base, sessionUuid: s.sessionId } as LiveSession,
      now,
    });
    expect(screen.getByText(fmtCost(entry.total))).toBeTruthy();
    expect(costTodayLine(entry)).toBeNull(); // all of it was today
    unmount();
    render(MeterStrip, { live: { ...base, sessionUuid: "nope" } as LiveSession, now });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("costTodayLine shows the sub-line only when part of the total was earlier", () => {
    expect(costTodayLine({ total: 18.76, today: 8.1 })).toBe("$8.10 today");
    expect(costTodayLine({ total: 3, today: 3 })).toBeNull();
    expect(costTodayLine(undefined)).toBeNull();
  });
});
