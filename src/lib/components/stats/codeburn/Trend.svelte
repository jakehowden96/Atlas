<script lang="ts">
  import { formatValue, niceTicks, type Unit } from "../../../stats-chart";
  import type { TrendDay, TrendSeries } from "./overview-derive";

  interface Props {
    days: TrendDay[];
    series: TrendSeries[];
    unit: Unit;
    /** Names the chart for screen readers. */
    label: string;
  }

  let { days, series, unit, label }: Props = $props();

  const H = 180;
  const PAD = { l: 44, r: 8, t: 8, b: 24 };
  let w = $state(0);
  let hover = $state<number | null>(null);

  const ticks = $derived(niceTicks(Math.max(0, ...days.map((d) => d.total))));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const x = (i: number) =>
    PAD.l + (days.length < 2 ? 0 : (i * (w - PAD.l - PAD.r)) / (days.length - 1));
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);

  /** One closed band per series, stacked bottom-up in series order. */
  const bands = $derived.by(() => {
    const base = days.map(() => 0);
    return series.map((s) => {
      const lo = [...base];
      days.forEach((d, i) => (base[i]! += d.parts[s.id] ?? 0));
      const up = (i: number) => `${x(i)},${y(base[i]!)}`;
      const down = (i: number) => `${x(i)},${y(lo[i]!)}`;
      const idx = days.map((_, i) => i);
      return {
        s,
        d: `M${idx.map(up).join("L")}L${[...idx].reverse().map(down).join("L")}Z`,
      };
    });
  });
  const line = $derived(`M${days.map((d, i) => `${x(i)},${y(d.total)}`).join("L")}`);

  const every = $derived(
    Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor((w - PAD.l) / 64)))),
  );
  const shown = $derived(hover ?? days.length - 1);
  const cur = $derived(days[shown]);

  function move(e: PointerEvent) {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const f = (e.clientX - r.left - PAD.l) / Math.max(1, w - PAD.l - PAD.r);
    hover = Math.max(0, Math.min(days.length - 1, Math.round(f * (days.length - 1))));
  }
  function key(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    hover = Math.max(0, Math.min(days.length - 1, (hover ?? days.length - 1) + step));
  }
  const readout = (d: TrendDay) =>
    `${d.label}, ${formatValue(d.total, unit)}` +
    series
      .filter((s) => d.parts[s.id])
      .map((s) => `, ${s.label} ${formatValue(d.parts[s.id]!, unit)}`)
      .join("");
</script>

<div class="trend" bind:clientWidth={w}>
  {#if days.length === 0}
    <p class="empty">No spend yet</p>
  {:else if w > 0}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <svg
      width={w}
      height={H}
      viewBox={`0 0 ${w} ${H}`}
      role="group"
      aria-label={`${label}. Use the left and right arrow keys to step through the chart.`}
      tabindex="0"
      onpointermove={move}
      onpointerleave={() => (hover = null)}
      onkeydown={key}
      onblur={() => (hover = null)}
    >
      {#each ticks as t (t)}
        <line class="grid" x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} />
        <text class="tick" x={PAD.l - 8} y={y(t) + 4} text-anchor="end"
          >{formatValue(t, unit, true)}</text
        >
      {/each}
      {#each days as d, i (d.key)}
        {#if i % every === 0}
          <text class="tick" x={x(i)} y={H - 6} text-anchor="middle">{d.label}</text>
        {/if}
      {/each}
      {#each bands as b (b.s.id)}
        <path d={b.d} fill={b.s.color} fill-opacity="0.55" />
      {/each}
      <path d={line} class="edge" />
      {#if hover !== null && cur}
        <line class="cursor" x1={x(shown)} x2={x(shown)} y1={PAD.t} y2={H - PAD.b} />
      {/if}
      {#if cur}<circle class="dot" cx={x(shown)} cy={y(cur.total)} r="4" />{/if}
    </svg>
    {#if cur}
      <div
        class="tip"
        class:idle={hover === null}
        style:left={`${Math.min(w - 8, Math.max(8, x(shown)))}px`}
      >
        <span>{cur.label}</span>
        <b>{formatValue(cur.total, unit)}</b>
      </div>
    {/if}
    <div class="sr" role="status" aria-live="polite">
      {hover !== null && cur ? readout(cur) : ""}
    </div>
  {/if}

  {#if series.length > 0}
    <ul class="legend" aria-label="Models">
      {#each series as s (s.id)}
        <li><i style:background={s.color}></i>{s.label}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .trend {
    position: relative;
    min-height: var(--sp-9);
  }
  svg {
    display: block;
    overflow: visible;
    touch-action: pan-y;
  }
  svg:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  .grid {
    stroke: var(--border);
  }
  .cursor {
    stroke: var(--border2);
  }
  .tick {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .edge {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--accent);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 0;
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-1) var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--elev-1);
    font-size: var(--fs-xs);
    white-space: nowrap;
    pointer-events: none;
    transform: translateX(-50%);
  }
  .tip.idle {
    display: none;
  }
  .tip span {
    color: var(--muted);
  }
  .tip b {
    font-family: var(--font-mono);
    font-weight: var(--fw-semi);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-5);
    margin: var(--sp-3) 0 0;
    padding: 0;
    list-style: none;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .legend i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
