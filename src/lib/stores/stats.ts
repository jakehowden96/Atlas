import { writable } from "svelte/store";
import type { StatsSummary } from "../../types/stats";
import { getClaudeStats, onStatsUpdate } from "../ipc";
import { log } from "../logger";
import { errorMessage } from "../ipc-error";

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

/** Why the last load failed, or null. Lets the screen tell "failed" from "nothing there". */
export const statsError = writable<string | null>(null);

/**
 * Publish `next` unless it is older than what is shown. A recompute started
 * earlier can finish later than one started after it (the watcher's and the
 * initial invoke's), and its stale result must not overwrite the newer one.
 */
function publish(next: StatsSummary): void {
  statsSummary.update((current) =>
    current && next.generatedAt && current.generatedAt && next.generatedAt < current.generatedAt
      ? current
      : next,
  );
}

/** Read the stats now. On failure the previous summary stays and `statsError` says why. */
export async function reloadStats(): Promise<void> {
  try {
    publish(await getClaudeStats());
    statsError.set(null);
  } catch (e) {
    log.error("stats", "getClaudeStats failed", e);
    statsError.set(errorMessage(e));
  } finally {
    statsLoading.set(false);
  }
}

/** Subscribe to recomputes, then load the cache. Returns the unsubscribe. */
export async function startStatsFeed(): Promise<() => void> {
  // Subscribed before the first (full-history) load so an update emitted while
  // it runs is not missed.
  let unsubscribe = () => {};
  try {
    unsubscribe = await onStatsUpdate(publish);
  } catch (e) {
    log.error("stats", "stats-update subscription failed", e);
  }
  await reloadStats();
  return unsubscribe;
}
