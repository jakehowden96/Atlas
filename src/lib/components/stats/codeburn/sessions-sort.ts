import type { SessionRow } from "../../../../types/codeburn-sessions";

export type SortKey =
  "title" | "project" | "cost" | "calls" | "turns" | "startedAt" | "outputTokens";

/** Sorted copy; numbers compare numerically, everything else as text. */
export function sortSessions(rows: SessionRow[], key: SortKey, desc: boolean): SessionRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y))) * dir
    );
  });
}

/** The category with the most spend across a session's segments, if any. */
export function topCategory(row: SessionRow): string {
  const by = new Map<string, number>();
  for (const s of row.contributions?.segments ?? [])
    by.set(s.category, (by.get(s.category) ?? 0) + s.cost);
  let best = "";
  let max = -1;
  for (const [k, v] of by) {
    if (v > max) {
      best = k;
      max = v;
    }
  }
  return best;
}
