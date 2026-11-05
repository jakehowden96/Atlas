import type { Yield } from "../../../../types/codeburn-yield";

/** Spend per commit and per productive session; null when the divisor is 0. */
export function yieldCosts(y: Yield): { perCommit: number | null; perProductive: number | null } {
  const commits = y.details.reduce((n, d) => n + (d.commitCount ?? 0), 0);
  const p = y.summary.productive;
  return {
    perCommit: commits > 0 ? y.summary.total.costUSD / commits : null,
    perProductive: p.sessions > 0 ? y.summary.total.costUSD / p.sessions : null,
  };
}
