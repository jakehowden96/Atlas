/** Shapes of `codeburn compare --format json` and `compare-periods --format json` (0.9.27). */
export interface ModelCompareRow {
  model: string;
  calls: number;
  cost: number;
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTurns: number;
  editTurns: number;
  oneShotTurns: number;
  retries: number;
  selfCorrections: number;
  editCost: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CohortStats {
  model: string;
  label: string;
  observationCount: number;
  retryRate: number;
  /** Percent, 0-100. */
  oneShotRate: number;
  costMedian: number | null;
  costP90: number | null;
  costMean: number | null;
}

export interface CohortComparison {
  kind: "cohort-comparison";
  modelA: { model: string; label: string; stats: CohortStats };
  modelB: { model: string; label: string; stats: CohortStats };
}

export interface PeriodTotals {
  cost: number;
  calls: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface PeriodRow {
  key: string;
  costA: number;
  costB: number;
  diff: number;
  /** Null when A is zero. */
  pct: number | null;
  status: string;
  callsA: number;
  callsB: number;
}

export interface PeriodCompare {
  rangeA: { from: string; to: string; days: number };
  rangeB: { from: string; to: string; days: number };
  totals: {
    A: PeriodTotals;
    B: PeriodTotals;
    diff: PeriodTotals;
    pct: Record<keyof PeriodTotals, number | null>;
  };
  projects: PeriodRow[];
  models: PeriodRow[];
}
