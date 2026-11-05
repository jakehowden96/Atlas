import type { ModelRow } from "../../../../types/codeburn-models";

/** Share of input-side tokens served from cache, 0..100. */
export function cacheHit(m: ModelRow): number {
  const total = m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens;
  return total > 0 ? (m.cacheReadTokens / total) * 100 : 0;
}

/** Calls with no price (e.g. `<synthetic>`), so cost reads $0 without being real. */
export function isUnpriced(m: ModelRow): boolean {
  return m.costUSD === 0 && m.calls > 0;
}

export const byCostDesc = (rows: ModelRow[]) => [...rows].sort((a, b) => b.costUSD - a.costUSD);
