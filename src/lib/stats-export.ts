import { toCsv } from "./stats-chart";
import {
  daySeries,
  HEATMAP_DAYS,
  localDayKey,
  projectRows,
  recentForRange,
  recentWeeks,
  sortedModels,
  modelsForRange,
  toolRows,
  totalsForRange,
  WEEK_COUNT,
  type Range,
} from "./stats-derive";
import type { RecentSession } from "../types/generated/RecentSession";
import type { StatsSummary } from "../types/generated/StatsSummary";

/**
 * Pure builders for the Stats screen's tables, CSV copies and file exports.
 * Values stay raw (dollars, token counts, seconds); timestamps stay ISO.
 */

export interface ExportData {
  range: Range;
  generatedAt: string;
  totals: unknown;
  models: Record<string, unknown>[];
  tools: { name: string; calls: number; errors: number }[];
  workspaces: { path: string; sessions: number; outputTokens: number; cost: number }[];
  weeks: { week: string; sessions: number }[];
  days: { date: string; sessions: number }[];
  sessions: RecentSession[];
}

export function buildExportData(s: StatsSummary, range: Range, now: Date): ExportData {
  return {
    range,
    generatedAt: s.generatedAt,
    totals: totalsForRange(s, range).current,
    models: sortedModels(modelsForRange(s, range)).map(([family, m]) => ({ family, ...m })),
    tools: toolRows(s, range).map((t) => ({ name: t.name, calls: t.count, errors: t.errors })),
    workspaces: projectRows(s, range).map(([path, p]) => ({
      path,
      sessions: p.sessions,
      outputTokens: p.outputTokens,
      cost: p.cost,
    })),
    weeks: recentWeeks(s.byWeek ?? {}, WEEK_COUNT).map(([week, w]) => ({
      week,
      sessions: w.sessions,
    })),
    days: daySeries(s.byDay ?? {}, now, HEATMAP_DAYS).map((d) => ({
      date: d.date,
      sessions: d.stats.sessions,
    })),
    sessions: recentForRange(s, range, now),
  };
}

export function exportJson(data: ExportData): string {
  return JSON.stringify(data, null, 2);
}

/** One long-form table: section, name, metric, value. Every cell is raw. */
export function exportCsv(data: ExportData): string {
  const rows: (string | number)[][] = [["section", "name", "metric", "value"]];
  for (const m of data.models) {
    const { family, ...rest } = m as { family: string } & Record<string, number>;
    for (const [metric, value] of Object.entries(rest)) rows.push(["model", family, metric, value]);
  }
  for (const t of data.tools) {
    rows.push(["tool", t.name, "calls", t.calls], ["tool", t.name, "errors", t.errors]);
  }
  for (const w of data.workspaces) {
    rows.push(
      ["workspace", w.path, "sessions", w.sessions],
      ["workspace", w.path, "outputTokens", w.outputTokens],
      ["workspace", w.path, "cost", w.cost],
    );
  }
  for (const w of data.weeks) rows.push(["week", w.week, "sessions", w.sessions]);
  for (const d of data.days) rows.push(["day", d.date, "sessions", d.sessions]);
  for (const s of data.sessions) {
    const name = s.title || s.sessionId;
    rows.push(
      ["session", name, "lastTimestamp", s.lastTimestamp ?? ""],
      ["session", name, "durationSecs", s.durationSecs],
      ["session", name, "outputTokens", s.outputTokens],
      ["session", name, "cost", s.costEstimate],
    );
  }
  return toCsv(rows);
}

// ── Recent sessions: sorting and bucket filter ───────────────────────────────

export type RecentSortKey =
  "title" | "cwd" | "model" | "durationSecs" | "outputTokens" | "costEstimate";

export function sortRecent(
  list: RecentSession[],
  key: RecentSortKey,
  desc: boolean,
): RecentSession[] {
  const dir = desc ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = a[key] ?? (typeof b[key] === "number" ? 0 : "");
    const y = b[key] ?? (typeof a[key] === "number" ? 0 : "");
    const c =
      typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * dir || a.sessionId.localeCompare(b.sessionId);
  });
}

export type Bucket = { kind: "day" | "week" | "workspace" | "model"; key: string; label: string };

/** ISO week key ("2026-W22") of a local date, as `byWeek` is keyed. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const slash = (p: string) =>
  p
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();

export function filterByBucket(list: RecentSession[], b: Bucket | null): RecentSession[] {
  if (!b) return list;
  return list.filter((s) => {
    if (b.kind === "model") return s.model === b.key;
    if (b.kind === "workspace") return !!s.cwd && slash(s.cwd) === slash(b.key);
    if (!s.lastTimestamp) return false;
    const d = new Date(s.lastTimestamp);
    if (Number.isNaN(d.getTime())) return false;
    return b.kind === "day" ? localDayKey(d) === b.key : isoWeekKey(d) === b.key;
  });
}
