import { writable } from "svelte/store";
import type { StatsSummary } from "../../types/stats";
import { getClaudeStats, onStatsUpdate } from "../ipc";
import { log } from "../logger";

/**
 * The one copy of the persisted Claude stats.
 *
 * The Stats screen used to own the only load, which left the top bar with no
 * history to read: its "today" figure summed `liveSessionList` and so showed
 * $0 for any work done outside this Atlas launch. The backend recomputes
 * within a second of a transcript write and emits `stats-update`, so a single
 * app-level holder keeps every reader honest.
 */
export const statsSummary = writable<StatsSummary | null>(null);

/** False once the first load has settled, successfully or not. */
export const statsLoading = writable(true);

/** Load the cache and subscribe to recomputes. Returns the unsubscribe. */
export async function startStatsFeed(): Promise<() => void> {
  try {
    statsSummary.set(await getClaudeStats());
  } catch (e) {
    log.error("stats", "getClaudeStats failed", e);
  } finally {
    statsLoading.set(false);
  }
  try {
    return await onStatsUpdate((s) => statsSummary.set(s));
  } catch (e) {
    log.error("stats", "stats-update subscription failed", e);
    return () => {};
  }
}
