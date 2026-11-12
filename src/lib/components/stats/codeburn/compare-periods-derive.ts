import type { PeriodRow } from "../../../../types/codeburn-compare";

export type Basis = "raw" | "day" | "calls";

export interface Mover {
  key: string;
  a: number;
  b: number;
  diff: number;
  /** Null when A is zero. */
  pct: number | null;
  isNew: boolean;
}

const DAY = 86_400_000;

/** Inclusive windows: B is the last 7 days ending `today`, A the 7 before it. */
export function presetRanges(today: Date) {
  const iso = (offset: number) =>
    new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - offset * DAY)
      .toISOString()
      .slice(0, 10);
  return { a0: iso(13), a1: iso(7), b0: iso(6), b1: iso(0) };
}

/** Movers on one basis (total, per day of its window, or per 100 calls), biggest change first. */
export function movers(rows: PeriodRow[], basis: Basis, daysA: number, daysB: number): Mover[] {
  const val = (cost: number, calls: number, days: number) =>
    basis === "day"
      ? cost / (days || 1)
      : basis === "calls"
        ? calls
          ? (cost / calls) * 100
          : 0
        : cost;
  return rows
    .map((r) => {
      const a = val(r.costA, r.callsA, daysA);
      const b = val(r.costB, r.callsB, daysB);
      return {
        key: r.key,
        a,
        b,
        diff: b - a,
        pct: a > 0 ? ((b - a) / a) * 100 : null,
        isNew: a === 0 && b > 0,
      };
    })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
}

type Daily = { date: string; cost: number }[];

/** Day i of window A beside day i of window B. */
export function dayPairs(daily: { A: Daily; B: Daily }, fromA: string, fromB: string, n: number) {
  const at = (d: Daily, from: string, i: number) => {
    const day = new Date(Date.parse(from) + i * DAY).toISOString().slice(0, 10);
    return d.find((x) => x.date === day)?.cost ?? 0;
  };
  return Array.from({ length: n }, (_, i) => ({
    i,
    a: at(daily.A, fromA, i),
    b: at(daily.B, fromB, i),
  }));
}

export type MoverSort = "key" | "a" | "b" | "diff" | "pct" | "ad";

/** Movers ordered by a column; "ad" is absolute change, the default. A missing % sorts as 0. */
export function sortMovers(list: Mover[], k: MoverSort, dir: 1 | -1): Mover[] {
  const val = (m: Mover) => (k === "ad" ? Math.abs(m.diff) : k === "pct" ? (m.pct ?? 0) : m[k]);
  return list.slice().sort((x, y) => {
    const u = val(x);
    const v = val(y);
    return (
      (typeof u === "string" ? u.localeCompare(v as string) : (u as number) - (v as number)) * dir
    );
  });
}
