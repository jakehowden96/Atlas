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
import type { StatsSummary } from "../../types/stats";
import { startStatsFeed, statsLoading, statsSummary } from "../stores/stats";

function summaryWith(cost: number): StatsSummary {
  return { totalCostEstimate: cost } as unknown as StatsSummary;
}

beforeEach(() => {
  vi.mocked(getClaudeStats).mockReset();
  vi.mocked(onStatsUpdate).mockReset();
  statsSummary.set(null);
  statsLoading.set(true);
});

describe("the stats feed", () => {
  /* The top bar and the Stats screen both need the same summary. Before this
     store the Stats screen was the only holder, so the top bar had no history
     to read and fell back to summing live tails. */
  it("publishes the summary it loads", async () => {
    vi.mocked(getClaudeStats).mockResolvedValue(summaryWith(12.5));
    vi.mocked(onStatsUpdate).mockResolvedValue(() => {});

    await startStatsFeed();

    expect(get(statsSummary)?.totalCostEstimate).toBe(12.5);
  });

  it("replaces the summary when the backend recomputes", async () => {
    vi.mocked(getClaudeStats).mockResolvedValue(summaryWith(12.5));
    const pushes: ((s: StatsSummary) => void)[] = [];
    vi.mocked(onStatsUpdate).mockImplementation(async (fn) => {
      pushes.push(fn);
      return () => {};
    });

    await startStatsFeed();
    pushes[0](summaryWith(44));

    expect(get(statsSummary)?.totalCostEstimate).toBe(44);
  });

  /* A missing or unreadable stats.json must not leave the app spinning. */
  it("stops loading even when the cache cannot be read", async () => {
    vi.mocked(getClaudeStats).mockRejectedValue(new Error("no such file"));
    vi.mocked(onStatsUpdate).mockResolvedValue(() => {});

    await startStatsFeed();

    expect(get(statsLoading)).toBe(false);
    expect(get(statsSummary)).toBeNull();
  });
});
