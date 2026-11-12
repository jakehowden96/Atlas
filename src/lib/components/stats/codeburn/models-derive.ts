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

export type SortKey =
  | "modelDisplayName"
  | "calls"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "costUSD"
  | "savingsUSD";

export function sortRows(rows: ModelRow[], s: { k: SortKey; dir: 1 | -1 }): ModelRow[] {
  return [...rows].sort((a, b) => {
    const x = a[s.k];
    const y = b[s.k];
    return (
      (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * s.dir
    );
  });
}

type PricingStatus = "priced" | "estimated" | "unpriced";

export function pricingStatus(m: ModelRow): PricingStatus {
  return isUnpriced(m) ? "unpriced" : m.isEstimated ? "estimated" : "priced";
}
