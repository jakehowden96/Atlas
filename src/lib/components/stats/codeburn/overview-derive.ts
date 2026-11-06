import type { Overview, Timeline } from "../../../../types/codeburn";
import { localDayKey } from "../../../stats-derive";
import type { Point } from "../../../stats-chart";

export type Metric = "cost" | "tokens";

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
}

export interface TrendDay {
  key: string;
  label: string;
  total: number;
  parts: Record<string, number>;
}

const FAMILIES = ["opus", "sonnet", "haiku"] as const;

/** Atlas's fixed model colours; a second model of one family is a paler mix. */
function modelColors(labels: string[]): string[] {
  const seen: Record<string, number> = {};
  return labels.map((label) => {
    const fam = FAMILIES.find((f) => label.toLowerCase().includes(f));
    if (!fam) return "var(--muted)";
    const n = (seen[fam] = (seen[fam] ?? -1) + 1);
    const base = `var(--model-${fam})`;
    return n === 0 ? base : `color-mix(in srgb, ${base} ${n === 1 ? 60 : 38}%, var(--surface))`;
  });
}

const dayLabel = (d: Date, hourly: boolean) =>
  hourly
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Per-bucket totals plus the per-model split, for the hero trend. */
export function trend(
  timeline: Timeline | undefined,
  metric: Metric,
): { days: TrendDay[]; series: TrendSeries[] } {
  if (!timeline) return { days: [], series: [] };
  const hourly = timeline.bucketMinutes < 1440;
  const totals = new Map<string, number>();
  for (const p of timeline.points)
    for (const m of p.models) totals.set(m.seriesId, (totals.get(m.seriesId) ?? 0) + m[metric]);
  const used = timeline.modelSeries
    .filter((s) => (totals.get(s.id) ?? 0) > 0)
    .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0));
  const colors = modelColors(used.map((s) => s.label));
  const series = used.map((s, i) => ({ id: s.id, label: s.label, color: colors[i]! }));
  const days = timeline.points.map((p) => ({
    key: p.timestamp,
    label: dayLabel(new Date(p.timestamp), hourly),
    total: p[metric],
    parts: Object.fromEntries(p.models.map((m) => [m.seriesId, m[metric]])),
  }));
  return { days, series };
}

/**
 * Calls per local day over the span of the timeline, padded so the first day
 * sits on its Monday-first row: Heatmap fills seven cells per column.
 */
export function activityCells(o: Overview): Point[] {
  const pts = o.history.timeline?.points ?? [];
  if (pts.length === 0) return [];
  const calls = new Map(o.history.daily.map((d) => [d.date, d.calls ?? 0]));
  const first = new Date(pts[0]!.timestamp);
  const last = new Date(pts[pts.length - 1]!.timestamp);
  first.setHours(0, 0, 0, 0);
  const cells: Point[] = [];
  for (let i = 0; i < (first.getDay() + 6) % 7; i++)
    cells.push({ key: `pad-${i}`, label: "", value: 0 });
  for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const key = localDayKey(d);
    cells.push({
      key,
      label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
      value: calls.get(key) ?? 0,
    });
  }
  return cells;
}

export interface EffRow {
  label: string;
  /** 0..100 share, for the bar. */
  pct: number;
  /** Whether a high value is the good direction. */
  good: "high" | "low";
}

/** The shares behind the efficiency card, each as 0..100. */
export function efficiencyRows(c: Overview["current"]): EffRow[] {
  const of = (usd: number | undefined) => (c.cost > 0 && usd ? (usd / c.cost) * 100 : 0);
  return [
    { label: "Cache hit", pct: c.cacheHitPercent, good: "high" },
    { label: "One-shot edits", pct: c.oneShotRate * 100, good: "high" },
    { label: "Retry tax", pct: of(c.retryTax?.totalUSD), good: "low" },
    { label: "Routing waste", pct: of(c.routingWaste?.totalSavingsUSD), good: "low" },
  ];
}

/** "4m 12s" for the median time to first edit. */
export function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export interface Pace {
  /** null when the data does not cover the day: shown as "—". */
  yesterday: number | null;
  /** Mean of the 7 days before `now`'s day. */
  avg7: number | null;
  /** Month-end estimate at the month's daily rate so far. */
  projected: number | null;
  /** Today against the 7-day mean. */
  vsAvg7Pct: number | null;
}

const dayBefore = (now: Date, n: number) =>
  localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

/** Yesterday, 7-day mean and month projection from daily cost, `monthCost` being the month to date. */
export function pace(
  daily: { date: string; cost: number }[],
  monthCost: number | null,
  now: Date,
): Pace {
  const by = new Map(daily.map((d) => [d.date, d.cost]));
  const first = daily.map((d) => d.date).sort()[0];
  const covers = (key: string) => first !== undefined && key >= first;
  const yk = dayBefore(now, 1);
  const prior = [1, 2, 3, 4, 5, 6, 7].map((n) => dayBefore(now, n));
  const avg7 = prior.every(covers) ? prior.reduce((s, k) => s + (by.get(k) ?? 0), 0) / 7 : null;
  const today = by.get(localDayKey(now));
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    yesterday: covers(yk) ? (by.get(yk) ?? 0) : null,
    avg7,
    projected: monthCost === null ? null : (monthCost / now.getDate()) * dim,
    vsAvg7Pct: avg7 && today !== undefined ? ((today - avg7) / avg7) * 100 : null,
  };
}

/** Consecutive-day streak is codeburn's `streak`; this only formats a signed percent. */
export const fmtPct = (p: number | null) =>
  p === null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
