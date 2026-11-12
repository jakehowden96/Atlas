<script lang="ts">
  import { fmtCost } from "../../../stats-derive";
  import type { TrendDay, TrendSeries } from "../codeburn/overview-derive";

  interface Props {
    days: TrendDay[];
    /** Models stacked per day; empty draws one accent bar per day. */
    series?: TrendSeries[];
    /** Names the chart for screen readers. */
    label: string;
  }

  let { days, series = [], label }: Props = $props();

  const H = 160;
  const L = 8;
  const R = 46;
  const T = 8;
  const B = 22;
  let W = $state(640);
  let hover = $state<number | null>(null);
  /** Series id under the pointer in the legend; other series fade. */
  let focus = $state<string | null>(null);

  const n = $derived(days.length);
  const peak = $derived(Math.max(0, ...days.map((d) => d.total)));
  const step = $derived([5, 10, 25, 50, 100, 200].find((s) => s * 3 >= peak) ?? 200);
  const top = $derived(Math.max(step, Math.ceil(peak / step) * step));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = $derived(Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step));
  const slot = $derived((W - L - R) / Math.max(1, n));
  const bw = $derived(Math.max(2, Math.min(28, slot * 0.7)));
  const every = $derived(Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - L) / 70)))));
  const bx = (i: number) => L + i * slot + (slot - bw) / 2;
  /** Stacked segments bottom-up; one accent segment when no per-model split exists. */
  const segs = (d: TrendDay) => {
    let lo = 0;
    const parts = series.length
      ? series.map((s) => ({ v: d.parts[s.id] ?? 0, color: s.color, id: s.id }))
      : [{ v: d.total, color: "var(--accent)", id: "" }];
    return parts.map((p) => {
      const out = { y: y(lo + p.v), h: Math.max(0, y(lo) - y(lo + p.v)), color: p.color, id: p.id };
      lo += p.v;
      return out;
    });
  };
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    hover = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / slot)));
  };
</script>

<div class="chart" bind:clientWidth={W}>
  {#if n === 0 || peak === 0}
    <p class="empty">No spend yet</p>
  {:else}
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      onpointermove={onMove}
      onpointerleave={() => (hover = null)}
    >
      {#each ticks as t (t)}
        <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
        <text x={W - R + 8} y={y(t) + 4}>${t}</text>
      {/each}
      {#each days as d, i (d.key)}
        {#each segs(d) as s, j (j)}
          <rect
            x={bx(i)}
            y={s.y}
            width={bw}
            height={s.h}
            style:fill={s.color}
            class:fade={focus !== null && s.id !== focus}
          />
        {/each}
        {#if i % every === 0}<text x={bx(i) + bw / 2} y={H - 6} text-anchor="middle">{d.label}</text
          >{/if}
      {/each}
      {#if n > 1}
        <line class="peak" x1={L} x2={W - R} y1={y(peak)} y2={y(peak)} />
        <text class="peak" x={W - 38} y={y(peak) + 4}>{fmtCost(peak)}</text>
      {/if}
    </svg>
    {#if hover !== null && days[hover]}
      <div class="tip" style:left={`${Math.max(70, Math.min(W - 70, L + (hover + 0.5) * slot))}px`}>
        <span class="m">{days[hover]!.label}</span><b>{fmtCost(days[hover]!.total)}</b>
      </div>
    {/if}
  {/if}
</div>
{#if series.length > 0}
  <ul class="legend" aria-label="Models">
    {#each series as s (s.id)}
      <li onpointerenter={() => (focus = s.id)} onpointerleave={() => (focus = null)}>
        <i style:background={s.color}></i>{s.label}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .chart {
    position: relative;
    width: 100%;
    min-height: 190px;
    padding-top: var(--sp-2);
    box-sizing: border-box;
  }
  svg {
    display: block;
    overflow: visible;
  }
  text {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  rect {
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .fade {
    opacity: 0.18;
  }
  .peak {
    stroke: var(--warn);
    stroke-dasharray: 4 4;
  }
  text.peak {
    fill: var(--warn);
    stroke: none;
    font-weight: var(--fw-semi);
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
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
  }
  .tip b {
    font-family: var(--font-mono);
    font-weight: var(--fw-semi);
  }
  .m {
    color: var(--muted);
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
    flex-shrink: 0;
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
