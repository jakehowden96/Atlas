/**
 * Formatting helpers shared by the top bar, session tiles and
 * the Stats screen.
 */
import { fmtCost } from "./format-cost";

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export function fmtTokens(n: number): string {
  // Round first, then pick the unit: 999_600 is "1000K" otherwise.
  if (Math.round(n / 1_000) >= 1_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

export { fmtCost };
export function fmtCount(n: number): string {
  return n >= 10_000 ? fmtTokens(n) : String(Math.round(n));
}

/**
 * `byDay` keys are calendar days in the machine's local time zone, as the
 * backend buckets them, so every key built here is a local date too.
 */
export function localDayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Tooltip on the top bar's spend figure. */
export const TODAY_COST_TIP =
  "All sessions, since midnight, as reported by codeburn. Session totals can be higher because they include earlier days.";
