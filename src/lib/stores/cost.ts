import { writable } from "svelte/store";
import { codeburn } from "./codeburn";

/**
 * The one source of cost figures for the app (top bar, session tiles, rail).
 * `null` means codeburn is missing or failed: consumers show "—".
 * Session ids are Claude's session uuids, the same ids Atlas sessions carry.
 */
export const todayCost = writable<number | null>(null);
export const monthCost = writable<number | null>(null);
export const sessionCosts = writable<Map<string, { total: number; today: number }> | null>(null);

interface Status {
  today: { cost: number };
  month: { cost: number };
}
interface SessionRow {
  sessionId: string;
  cost: number;
}

const REFRESH_MS = 60_000;

/** Reload all three. `fresh` skips the shared codeburn cache. Never throws. */
export async function refreshCosts(fresh = false): Promise<void> {
  const [status, all, today] = await Promise.all([
    codeburn<Status>(["status", "--format", "json"], fresh).catch(() => null),
    codeburn<SessionRow[]>(["sessions", "--format", "json", "--period", "all"], fresh).catch(
      () => null,
    ),
    codeburn<SessionRow[]>(["sessions", "--format", "json", "--period", "today"], fresh).catch(
      () => null,
    ),
  ]);
  todayCost.set(status?.today?.cost ?? null);
  monthCost.set(status?.month?.cost ?? null);
  if (!all) {
    sessionCosts.set(null);
    return;
  }
  const todayById = new Map((today ?? []).map((s) => [s.sessionId, s.cost]));
  sessionCosts.set(
    new Map(all.map((s) => [s.sessionId, { total: s.cost, today: todayById.get(s.sessionId) ?? 0 }])),
  );
}

/** Load now, then every 60s while the window is visible. Returns a stop function. */
export function startCostRefresh(): () => void {
  void refreshCosts();
  const id = setInterval(() => {
    if (document.visibilityState === "visible") void refreshCosts(true);
  }, REFRESH_MS);
  return () => clearInterval(id);
}
