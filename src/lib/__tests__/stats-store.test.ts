import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../ipc", () => ({
  getClaudeStats: vi.fn(),
  onStatsUpdate: vi.fn(),
}));
vi.mock("../logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { get } from "svelte/store";
import { getClaudeStats, onStatsUpdate } from "../ipc";
import type { StatsSummary } from "../../types/generated/StatsSummary";
import {
  reloadStats,
  startStatsFeed,
  statsError,
  statsLoading,
  statsSummary,
} from "../stores/stats";

function summaryWith(cost: number): StatsSummary {
  return { totalsAll: { cost } } as unknown as StatsSummary;
}

beforeEach(() => {
  vi.mocked(getClaudeStats).mockReset();
  vi.mocked(onStatsUpdate).mockReset();
  statsSummary.set(null);
  statsLoading.set(true);
  statsError.set(null);
});

describe("the stats feed", () => {
  /* The top bar and the Stats screen both need the same summary. Before this
     store the Stats screen was the only holder, so the top bar had no history
     to read and fell back to summing live tails. */
  it("publishes the summary it loads", async () => {
    vi.mocked(getClaudeStats).mockResolvedValue(summaryWith(12.5));
    vi.mocked(onStatsUpdate).mockResolvedValue(() => {});

    await startStatsFeed();

    expect(get(statsSummary)?.totalsAll.cost).toBe(12.5);
  });

  it("replaces the summary when the backend recomputes", async () => {
    vi.mocked(getClaudeStats).mockResolvedValue(summaryWith(12.5));
    const pushes: ((s: StatsSummary) => void)[] = [];
    vi.mocked(onStatsUpdate).mockImplementation(async (fn) => {
      pushes.push(fn);
      return () => {};
    });

    await startStatsFeed();
    pushes[0]!(summaryWith(44));

    expect(get(statsSummary)?.totalsAll.cost).toBe(44);
  });

  /* A missing or unreadable stats.json must not leave the app spinning. */
  it("stops loading even when the cache cannot be read", async () => {
    vi.mocked(getClaudeStats).mockRejectedValue(new Error("no such file"));
    vi.mocked(onStatsUpdate).mockResolvedValue(() => {});

    await startStatsFeed();

    expect(get(statsLoading)).toBe(false);
    expect(get(statsSummary)).toBeNull();
  });

  /* A failed read must not look like an empty history. */
  it("records why a load failed and clears it once a retry works", async () => {
    vi.mocked(getClaudeStats).mockRejectedValueOnce(new Error("disk on fire"));
    vi.mocked(onStatsUpdate).mockResolvedValue(() => {});

    await startStatsFeed();
    expect(get(statsError)).toBe("disk on fire");

    vi.mocked(getClaudeStats).mockResolvedValue(summaryWith(3));
    await reloadStats();
    expect(get(statsError)).toBeNull();
    expect(get(statsSummary)?.totalsAll.cost).toBe(3);
  });

  /* The listener must exist before the slow first load, or an update emitted
     during it is lost. */
  it("subscribes before the first load", async () => {
    const order: string[] = [];
    vi.mocked(onStatsUpdate).mockImplementation(async () => {
      order.push("subscribe");
      return () => {};
    });
    vi.mocked(getClaudeStats).mockImplementation(async () => {
      order.push("load");
      return summaryWith(1);
    });

    await startStatsFeed();

    expect(order).toEqual(["subscribe", "load"]);
  });

  /* Two recomputes can finish in reverse order; the older must not win. */
  it("ignores a summary older than the one it already has", async () => {
    const at = (generatedAt: string, cost: number) =>
      ({ generatedAt, totalsAll: { cost } }) as unknown as StatsSummary;
    vi.mocked(getClaudeStats).mockResolvedValue(at("2026-01-01T00:00:02Z", 2));
    const pushes: ((s: StatsSummary) => void)[] = [];
    vi.mocked(onStatsUpdate).mockImplementation(async (fn) => {
      pushes.push(fn);
      return () => {};
    });

    await startStatsFeed();
    pushes[0]!(at("2026-01-01T00:00:01Z", 1));

    expect(get(statsSummary)?.totalsAll.cost).toBe(2);
  });
});
