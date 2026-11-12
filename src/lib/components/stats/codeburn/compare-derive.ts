import type { CohortObservation, ModelCompareRow } from "../../../../types/codeburn-compare";

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

/** Per-model figures for the Classic tables. Null means codeburn has no data. */
export function metricsOf(r: ModelCompareRow) {
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  const span = Math.round((Date.parse(r.lastSeen) - Date.parse(r.firstSeen)) / 864e5) + 1;
  return {
    oneShot: pct(r.oneShotTurns, r.editTurns),
    retry: div(r.retries, r.editTurns),
    selfCorr: pct(r.selfCorrections, r.editTurns),
    costPerCall: div(r.cost, r.calls),
    costPerEdit: div(r.editCost, r.editTurns),
    outPerCall: div(r.outputTokens, r.calls),
    cache: pct(r.cacheReadTokens, r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens),
    days: Number.isFinite(span) ? span : null,
  };
}

/** 1 when a wins, -1 when b wins, 0 for ties or missing data. dir 1: higher is better, -1: lower. */
export function win(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null || b === null || a === b) return 0;
  return (a > b ? 1 : -1) * dir;
}

/** One-line banner; null when either model lacks edit turns. */
export function verdict(a: ModelCompareRow, b: ModelCompareRow): string | null {
  const ma = metricsOf(a);
  const mb = metricsOf(b);
  if (!ma.costPerEdit || !mb.costPerEdit || ma.oneShot === null || mb.oneShot === null) return null;
  const aCheap = ma.costPerEdit <= mb.costPerEdit;
  const cheap = aCheap ? a : b;
  const ratio = Math.max(ma.costPerEdit, mb.costPerEdit) / Math.min(ma.costPerEdit, mb.costPerEdit);
  const cost =
    ratio === 1 ? "Same cost per edit" : `${cheap.model} is ${ratio.toFixed(1)}x cheaper per edit`;
  const gap = Math.round(Math.abs(ma.oneShot - mb.oneShot));
  if (!gap) return `${cost}.`;
  const best = ma.oneShot >= mb.oneShot ? a : b;
  return best === cheap
    ? `${cost} and ${gap} pts higher on one-shot.`
    : `${cost}; ${best.model} is ${gap} pts higher on one-shot.`;
}

/** Paired one-shot rate and mean cost per task category or project; null where a side has no data. */
export function cohortRows(
  a: CohortObservation[],
  b: CohortObservation[],
  by: "category" | "project",
) {
  const side = (obs: CohortObservation[]) => {
    const m = new Map<string, { n: number; one: number; cost: number; known: number }>();
    for (const o of obs) {
      const g = m.get(o[by]) ?? { n: 0, one: 0, cost: 0, known: 0 };
      g.n++;
      if (o.oneShot) g.one++;
      if (o.costKnown) {
        g.cost += o.costUSD;
        g.known++;
      }
      m.set(o[by], g);
    }
    return m;
  };
  const sa = side(a);
  const sb = side(b);
  const f = (g?: { n: number; one: number; cost: number; known: number }) => ({
    n: g?.n ?? 0,
    rate: g?.n ? (g.one / g.n) * 100 : null,
    cost: g?.known ? g.cost / g.known : null,
  });
  return [...new Set([...sa.keys(), ...sb.keys()])].sort().map((key) => {
    const x = f(sa.get(key));
    const y = f(sb.get(key));
    return { key, a: x, b: y, minN: Math.min(x.n, y.n) };
  });
}

/** Last path segment, so worktree keys stay readable. */
export function shortKey(key: string): string {
  return key.split(/[\\/]/).filter(Boolean).pop() ?? key;
}

/** Series colour for a model: its family token, mixed toward the surface for later models of one family. */
export function modelColor(model: string, all: string[]): string {
  const fam = ["sonnet", "opus", "haiku"].find((f) => model.toLowerCase().includes(f));
  if (!fam) return "var(--muted)";
  const n = all.filter((m) => m.toLowerCase().includes(fam)).indexOf(model);
  const base = `var(--model-${fam})`;
  return n <= 0 ? base : `color-mix(in srgb, ${base} ${n === 1 ? 60 : 38}%, var(--surface))`;
}
