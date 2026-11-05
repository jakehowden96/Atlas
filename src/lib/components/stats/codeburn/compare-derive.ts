import type { ModelCompareRow } from "../../../../types/codeburn-compare";

export interface ModelStat {
  model: string;
  cost: number;
  calls: number;
  costPerCall: number;
  /** 0-1, or null when the model made no edit turns. */
  oneShotRate: number | null;
  retries: number;
}

/** Derived per-model metrics, most expensive first. */
export function modelStats(rows: ModelCompareRow[]): ModelStat[] {
  return rows
    .map((r) => ({
      model: r.model,
      cost: r.cost,
      calls: r.calls,
      costPerCall: r.calls > 0 ? r.cost / r.calls : 0,
      oneShotRate: r.editTurns > 0 ? r.oneShotTurns / r.editTurns : null,
      retries: r.retries,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** Last path segment, so worktree keys stay readable. */
export function shortKey(key: string): string {
  return key.split(/[\\/]/).filter(Boolean).pop() ?? key;
}
