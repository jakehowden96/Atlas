/**
 * Pure derivations behind the stats dashboard.
 *
 * These live outside `StatsView.svelte` so the range windowing, the delta
 * arithmetic and the day-series filling can be unit-tested — the test env has
 * no Svelte compiler and no DOM, so nothing inside a `.svelte` file is reachable.
 */
import { formatAgo } from "./format";
import type {
  DayStats,
  ModelStats,
  ProjectStats,
  RangeTotals,
  RecentSession,
  StatsSummary,
  WeekStats,
} from "../types/stats";

export type Range = "7d" | "30d" | "all";

/** How many days each range covers. `all` is unbounded. */
export const RANGE_DAYS: Record<Range, number | null> = { "7d": 7, "30d": 30, all: null };

export const RANGE_LABELS: Record<Range, string> = {
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

/** How many days the activity heatmap always shows, whatever the range. */
export const HEATMAP_DAYS = 30;

/** How many weeks the weekly bar chart always shows, whatever the range. */
export const WEEK_COUNT = 8;

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

export function fmtCost(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function fmtF1(n: number): string {
  return n.toFixed(1);
}

export function fmtCount(n: number): string {
  return n >= 10_000 ? fmtTokens(n) : String(Math.round(n));
}

/** "12s ago" / "4m ago" / "2h ago" for the live-refresh indicator. */
export function agoLabel(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  return formatAgo(then, now.getTime(), "second");
}

// ── Deltas ────────────────────────────────────────────────────────────────────

/**
 * A KPI's change against the equally-sized window before it.
 * `none` renders blank — All time has no previous period to compare with.
 */
export type Delta =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "pct"; value: number };

export function delta(current: number, previous: number | null): Delta {
  if (previous === null) return { kind: "none" };
  if (previous === 0) return current > 0 ? { kind: "new" } : { kind: "pct", value: 0 };
  return { kind: "pct", value: ((current - previous) / previous) * 100 };
}

export function deltaLabel(d: Delta): string {
  if (d.kind === "none") return "";
  if (d.kind === "new") return "new";
  const rounded = Math.round(d.value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Token name only — the component maps it to a CSS custom property. */
export function deltaTone(d: Delta): "up" | "down" | "flat" {
  if (d.kind === "new") return "up";
  if (d.kind === "pct" && d.value > 0) return "up";
  if (d.kind === "pct" && d.value < 0) return "down";
  return "flat";
}

// ── Range selection ───────────────────────────────────────────────────────────

export function modelsForRange(s: StatsSummary, r: Range): Record<string, ModelStats> {
  if (r === "7d") return s.byModel7d ?? {};
  if (r === "30d") return s.byModel30d ?? {};
  return s.byModel ?? {};
}

export function projectsForRange(s: StatsSummary, r: Range): Record<string, ProjectStats> {
  if (r === "7d") return s.byProject7d ?? {};
  if (r === "30d") return s.byProject30d ?? {};
  return s.byProject ?? {};
}

/** Current window plus the equally-sized one before it — `null` for All time. */
export function totalsForRange(
  s: StatsSummary,
  r: Range,
): { current: RangeTotals; previous: RangeTotals | null } {
  if (r === "7d") return { current: s.totals7d, previous: s.totalsPrev7d };
  if (r === "30d") return { current: s.totals30d, previous: s.totalsPrev30d };
  return { current: s.totalsAll, previous: null };
}

export interface ToolRow {
  name: string;
  count: number;
  errors: number;
  /** 0–100. */
  errorPct: number;
}

/** Tools in the selected window, busiest first. */
export function toolRows(s: StatsSummary, r: Range): ToolRow[] {
  const usage = r === "7d" ? s.toolUsage7d : r === "30d" ? s.toolUsage30d : s.toolUsage;
  const errors = r === "7d" ? s.toolErrors7d : r === "30d" ? s.toolErrors30d : s.toolErrors;
  return Object.entries(usage ?? {})
    .map(([name, count]) => {
      const errs = errors?.[name] ?? 0;
      return { name, count, errors: errs, errorPct: count > 0 ? (errs / count) * 100 : 0 };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Workspaces in the selected window, costliest first. */
export function projectRows(s: StatsSummary, r: Range): [string, ProjectStats][] {
  return Object.entries(projectsForRange(s, r)).sort(
    ([pa, a], [pb, b]) => b.cost - a.cost || b.sessions - a.sessions || pa.localeCompare(pb),
  );
}

/**
 * Recent sessions inside the selected window. The backend already caps and
 * sorts the list, so this only trims by date.
 */
export function recentForRange(s: StatsSummary, r: Range, now: Date): RecentSession[] {
  const days = RANGE_DAYS[r];
  const list = s.recentSessions ?? [];
  if (days === null) return list;
  const cutoff = now.getTime() - days * 86_400_000;
  return list.filter((session) => {
    if (!session.lastTimestamp) return false;
    const t = new Date(session.lastTimestamp).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
}

// ── Day series ────────────────────────────────────────────────────────────────

/**
 * `byDay` keys are the UTC date prefix of each session's first timestamp, so
 * every key this module builds is a UTC date too.
 */
export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DayPoint {
  date: string;
  stats: DayStats;
}

const EMPTY_DAY: DayStats = {
  sessions: 0,
  outputTokens: 0,
  userMessages: 0,
  cost: 0,
  peakContext: 0,
  subagents: 0,
};

/** `count` consecutive UTC days ending today, oldest first, gaps filled with zeroes. */
export function daySeries(
  byDay: Record<string, DayStats>,
  today: Date,
  count: number,
): DayPoint[] {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const out: DayPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = utcDayKey(new Date(end - i * 86_400_000));
    out.push({ date, stats: byDay[date] ?? EMPTY_DAY });
  }
  return out;
}

/**
 * The day window a sparkline covers. All time runs from the first day with any
 * data up to today, so the line really is the whole history rather than a tail.
 */
export function sparkSeries(
  byDay: Record<string, DayStats>,
  r: Range,
  today: Date,
): DayPoint[] {
  const fixed = RANGE_DAYS[r];
  if (fixed !== null) return daySeries(byDay, today, fixed);
  const keys = Object.keys(byDay ?? {}).sort();
  if (keys.length === 0) return [];
  const first = Date.parse(`${keys[0]}T00:00:00Z`);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const span = Math.floor((end - first) / 86_400_000) + 1;
  return daySeries(byDay, today, Math.max(1, span));
}

export function peakDay(points: DayPoint[]): DayPoint | null {
  let best: DayPoint | null = null;
  for (const p of points) {
    if (p.stats.sessions > 0 && (best === null || p.stats.sessions > best.stats.sessions)) {
      best = p;
    }
  }
  return best;
}

/** "2026-09-08" -> "8 Sep". */
export function shortDate(key: string): string {
  const t = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(t)) return key;
  const d = new Date(t);
  return `${d.getUTCDate()} ${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

// ── Models ────────────────────────────────────────────────────────────────────

/** Opus, then Fable, Sonnet, Haiku, then anything else alphabetically. */
export const MODEL_ORDER = ["Opus", "Fable", "Sonnet", "Haiku"];

/**
 * The ten By-model rows, in the design's order. Every value is a field that
 * already exists on `ModelStats` — nothing is recomputed here.
 */
export function modelRows(models: [string, ModelStats][]): { label: string; values: string[] }[] {
  const col = (pick: (m: ModelStats) => string) => models.map(([, m]) => pick(m));
  return [
    { label: "Sessions", values: col((m) => String(m.sessions)) },
    { label: "Output tokens", values: col((m) => fmtTokens(m.outputTokens)) },
    { label: "Est. cost", values: col((m) => fmtCost(m.cost)) },
    { label: "Avg session", values: col((m) => fmtDuration(m.avgDurationSecs)) },
    { label: "Tools / session", values: col((m) => fmtF1(m.toolsPerSession)) },
    { label: "Error rate", values: col((m) => `${(m.errorRate * 100).toFixed(1)}%`) },
    { label: "Subagents / session", values: col((m) => fmtF1(m.subagentsPerSession)) },
    { label: "Cost / 1K output", values: col((m) => fmtCost(m.costPerKOutput)) },
    { label: "Peak context", values: col((m) => fmtTokens(m.peakContextMax)) },
    { label: "Avg message length", values: col((m) => `${Math.round(m.avgMessageChars)} chars`) },
  ];
}

export function sortedModels(byModel: Record<string, ModelStats>): [string, ModelStats][] {
  return Object.entries(byModel).sort(([a], [b]) => modelRank(a) - modelRank(b) || a.localeCompare(b));
}

export function modelRank(family: string): number {
  const i = MODEL_ORDER.indexOf(family);
  return i === -1 ? 99 : i;
}

/** The design's fixed model palette; anything unrecognised falls back to --muted. */
export function modelColour(family: string): string {
  if (family === "Opus") return "var(--model-opus)";
  if (family === "Sonnet") return "var(--model-sonnet)";
  if (family === "Haiku") return "var(--model-haiku)";
  if (family === "Fable") return "var(--warn)";
  return "var(--muted)";
}

// ── Weeks ─────────────────────────────────────────────────────────────────────

/** The newest `count` ISO weeks present, oldest first (left to right on the chart). */
export function recentWeeks(
  byWeek: Record<string, WeekStats>,
  count: number,
): [string, WeekStats][] {
  return Object.entries(byWeek ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-count);
}

/** "2026-W22" -> "25 May" (the Monday of that ISO week). */
export function weekLabel(weekKey: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return weekKey;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week 1 is the week containing Jan 4th.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
  return `${monday.getUTCDate()} ${monday.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

/** Model families present across the shown weeks, in display order. */
export function weekFamilies(weeks: [string, WeekStats][]): string[] {
  const seen = new Set<string>();
  for (const [, ws] of weeks) for (const f of Object.keys(ws.byModel)) seen.add(f);
  return [...seen].sort((a, b) => modelRank(a) - modelRank(b) || a.localeCompare(b));
}

// ── Today's spend ─────────────────────────────────────────────────────────────

/** Whether `iso` falls on the same local calendar day as `now`. */
function isSameLocalDay(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * What today has cost, across every session on disk rather than only the ones
 * Atlas happens to be tailing.
 *
 * The top bar summed `liveSessionList`, so a day spent in Claude Code outside
 * Atlas — or any work from before this launch — read as $0. `recentSessions`
 * is the persisted per-session history, refreshed by the stats watcher within
 * a second of any transcript write, and is keyed on last activity, which is
 * what "today" means for a spend figure.
 */
export function todayCost(summary: StatsSummary | null, now: Date): number {
  if (!summary) return 0;
  const recent = summary.recentSessions ?? [];
  const today = recent.filter((s) => isSameLocalDay(s.lastTimestamp, now));
  const sum = today.reduce((acc, s) => acc + s.costEstimate, 0);
  /* The window is the newest 50. Once all of it is today it is a floor rather
     than a total, so the persisted day bucket takes over when it is larger.
     That bucket is keyed on each session's *first* timestamp in UTC, which is
     why it is only ever used as the larger of the two. */
  if (today.length < recent.length) return sum;
  return Math.max(sum, summary.byDay?.[utcDayKey(now)]?.cost ?? 0);
}
