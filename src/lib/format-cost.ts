export function fmtCost(n: number): string {
  if (n >= 1000)
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

/** "$8.10 today" under a session's total, or null when all of it was today. */
export function costTodayLine(c: { total: number; today: number } | undefined): string | null {
  return c && Math.abs(c.total - c.today) >= 0.005 ? `${fmtCost(c.today)} today` : null;
}
