export type Unit = "usd" | "tokens" | "count";

/** One bucket of a chart: a day, a model, a tool. */
export interface Point {
  key: string;
  label: string;
  value: number;
  /** Extra tooltip context, e.g. "2.3× the median". */
  context?: string;
}

/** Axis ticks from 0 up to a nice top >= max, at most 3 intervals. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const n = Math.ceil(max / step - 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => +(i * step).toPrecision(12));
}

function compact(v: number): string {
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

/** `tick` drops the cents on whole numbers for axis labels ("$10"). */
export function formatValue(v: number, unit: Unit, tick = false): string {
  if (unit === "usd") return tick && Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
  if (unit === "tokens") return tick ? compact(v) : `${compact(v)} tokens`;
  return `${Math.round(v)}`;
}

/** Indexes whose x label is shown: all when n <= 7, else first, middle, last. */
export function visibleLabels(n: number): Set<number> {
  if (n <= 7) return new Set(Array.from({ length: n }, (_, i) => i));
  return new Set([0, Math.floor((n - 1) / 2), n - 1]);
}

/** Heatmap step 0..4 for a value against the busiest cell. */
export function heatStep(v: number, max: number): number {
  if (!(v > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.ceil((v / max) * 4));
}

export const heatColor = (step: number): string =>
  `color-mix(in srgb, var(--accent) ${step * 25}%, var(--surface3))`;

/** Legend labels per step: "0", then the lowest count that lands in each step. */
export function heatLegend(max: number): string[] {
  const low = [1, 2, 3, 4].map((k) => (max > 0 ? Math.floor(((k - 1) * max) / 4) + 1 : 1));
  return ["0", ...low.map((n) => `${n}+`)];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** "2.3× the median", or "" when there is nothing to compare against. */
export function medianText(value: number, values: number[]): string {
  const m = median(values);
  return m > 0 ? `${(value / m).toFixed(1)}× the median` : "";
}

/** "+12% vs last week". */
export function deltaText(pct: number, versus: string): string {
  const r = Math.round(pct);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}% vs ${versus}`;
}

export function pointText(p: Point, unit: Unit): string {
  return `${p.label}: ${[formatValue(p.value, unit), p.context].filter(Boolean).join(" · ")}`;
}

export function toCsv(rows: (string | number)[][]): string {
  const q = (c: string | number) =>
    /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c);
  return rows.map((r) => r.map(q).join(",")).join("\n");
}

/**
 * One tab stop for a set of marks: the group holds a roving tabindex over
 * `[data-mark]`. Left/right move by `h`, up/down by `v`, Home/End jump.
 */
export function roving(node: HTMLElement, steps: { h: number; v: number } = { h: 1, v: 1 }) {
  let opts = steps;
  const marks = () => [...node.querySelectorAll<HTMLElement>("[data-mark]")];
  const sync = (active?: HTMLElement) => {
    const all = marks();
    const cur = active ?? all.find((m) => m.tabIndex === 0) ?? all[0];
    for (const m of all) m.tabIndex = m === cur ? 0 : -1;
  };
  const onFocusin = (e: FocusEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-mark]");
    if (t) sync(t);
  };
  const onKey = (e: KeyboardEvent) => {
    const all = marks();
    const here = (e.target as HTMLElement).closest<HTMLElement>("[data-mark]");
    const i = here ? all.indexOf(here) : -1;
    if (i < 0) return;
    const delta: Record<string, number> = {
      ArrowRight: opts.h,
      ArrowLeft: -opts.h,
      ArrowDown: opts.v,
      ArrowUp: -opts.v,
    };
    let next: number;
    if (e.key in delta) next = Math.min(all.length - 1, Math.max(0, i + delta[e.key]!));
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = all.length - 1;
    else return;
    e.preventDefault();
    sync(all[next]);
    all[next]!.focus();
  };
  // Marks are rendered after the action runs and re-rendered on data changes.
  const obs = new MutationObserver(() => sync());
  obs.observe(node, { childList: true, subtree: true });
  sync();
  node.addEventListener("focusin", onFocusin);
  node.addEventListener("keydown", onKey);
  return {
    update(next: { h: number; v: number }) {
      opts = next;
    },
    destroy() {
      obs.disconnect();
      node.removeEventListener("focusin", onFocusin);
      node.removeEventListener("keydown", onKey);
    },
  };
}
