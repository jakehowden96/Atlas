import type { Overview, Timeline } from "../../../../types/codeburn";
import { localDayKey } from "../../../stats-derive";
import type { Point } from "../../../stats-chart";
import { modelColor } from "./compare-derive";

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
  const labels = used.map((s) => s.label);
  const series = used.map((s) => ({
    id: s.id,
    label: s.label,
    color: modelColor(s.label, labels),
  }));
  const days = timeline.points.map((p) => ({
    key: p.timestamp,
    label: dayLabel(new Date(p.timestamp), hourly),
    total: p[metric],
    parts: Object.fromEntries(p.models.map((m) => [m.seriesId, m[metric]])),
  }));
  return { days, series };
}

/**
 * Calls per local day for the last `weeks` weeks ending `now`, Monday-first so
 * Heatmap fills seven cells per column. Starts at the first day with data when
 * that is later than the window, so days the data cannot cover are not drawn as 0.
 */
export function activityCells(o: Overview, now = new Date(), weeks = 20): Point[] {
  const daily = o.history.daily;
  if (daily.length === 0) return [];
  const calls = new Map(daily.map((d) => [d.date, d.calls ?? 0]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const begin = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7,
  );
  const firstDay = new Date(`${daily.map((d) => d.date).sort()[0]}T00:00:00`);
  const first = firstDay > begin ? firstDay : begin;
  const cells: Point[] = [];
  for (let i = 0; i < (first.getDay() + 6) % 7; i++)
    cells.push({ key: `pad-${i}`, label: "", value: 0 });
  for (const d = new Date(first); d <= today; d.setDate(d.getDate() + 1)) {
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

/** The shares behind the efficiency bars, each as 0..100. */
export function efficiencyRows(c: Overview["current"]): EffRow[] {
  const retry = c.cost > 0 && c.retryTax?.totalUSD ? (c.retryTax.totalUSD / c.cost) * 100 : 0;
  return [
    { label: "One-shot", pct: c.oneShotRate * 100, good: "high" },
    { label: "Cache hit", pct: c.cacheHitPercent, good: "high" },
    { label: "Retry tax", pct: retry, good: "low" },
  ];
}

/** Efficiency ring, ported 1:1 from the CodeBurn desktop app's renderer (components BT and LT). */
export function efficiencyScore(c: Overview["current"]): { score: number; grade: string } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const oneShot = c.oneShotRate ?? 0.6;
  const cache = clamp(c.cacheHitPercent / 100);
  const retry = clamp(((c.retryTax?.totalUSD ?? 0) / Math.max(c.cost, 1e-9)) * 4);
  const score = 100 * (0.45 * oneShot + 0.3 * cache + 0.25 * (1 - retry));
  const grade =
    score >= 93
      ? "A+"
      : score >= 85
        ? "A"
        : score >= 75
          ? "B"
          : score >= 65
            ? "C"
            : score >= 55
              ? "D"
              : "F";
  return { score: Math.round(score), grade };
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
  /** Today against yesterday. */
  vsYesterdayPct: number | null;
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
  const yesterday = covers(yk) ? (by.get(yk) ?? 0) : null;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    yesterday,
    avg7,
    projected: monthCost === null ? null : (monthCost / now.getDate()) * dim,
    vsYesterdayPct:
      yesterday && today !== undefined ? ((today - yesterday) / yesterday) * 100 : null,
  };
}

const iso = (y: number, m: number, d: number) => localDayKey(new Date(y, m, d));

/** compare-periods windows: this month's days so far (B) against the same days of last month (A). */
export function monthWindows(now: Date): string[] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const n = now.getDate();
  const lastDim = new Date(y, m, 0).getDate();
  return [
    ...["--from-a", iso(y, m - 1, 1), "--to-a", iso(y, m - 1, Math.min(n, lastDim))],
    ...["--from-b", iso(y, m, 1), "--to-b", iso(y, m, n)],
  ];
}

/** compare-periods windows: the 7 days before the last 7 (A) against the last 7, today included (B). */
export function weekWindows(now: Date): string[] {
  const [y, m, d] = [now.getFullYear(), now.getMonth(), now.getDate()];
  return [
    ...["--from-a", iso(y, m, d - 13), "--to-a", iso(y, m, d - 7)],
    ...["--from-b", iso(y, m, d - 6), "--to-b", iso(y, m, d)],
  ];
}

/** Running month-to-date cost, one entry per day from the 1st to `now`'s day. */
export function monthCumulative(daily: { date: string; cost: number }[], now: Date): number[] {
  const by = new Map(daily.map((d) => [d.date, d.cost]));
  let sum = 0;
  return Array.from({ length: now.getDate() }, (_, i) => {
    sum += by.get(iso(now.getFullYear(), now.getMonth(), i + 1)) ?? 0;
    return sum;
  });
}

/** Consecutive-day streak is codeburn's `streak`; this only formats a signed percent. */
export const fmtPct = (p: number | null) =>
  p === null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
