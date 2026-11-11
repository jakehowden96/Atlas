<script lang="ts">
  import { fmtCost } from "../../../stats-derive";

  let { days }: { days: { label: string; total: number }[] } = $props();

  // Mirrors the design's spChart: gridlines, right-hand $ axis, dashed peak line.
  const H = 190;
  const L = 8;
  const R = 52;
  const T = 10;
  const B = 22;
  let width = $state(640);

  const n = $derived(days.length);
  const mx = $derived(Math.max(0, ...days.map((d) => d.total)) || 1);
  const step = $derived([5, 10, 25, 50, 100, 200].find((s) => s * 3 >= mx) ?? 200);
  const top = $derived(Math.ceil(mx / step) * step);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const slot = $derived((width - L - R) / n);
  const bw = $derived(Math.max(2, Math.min(28, slot * 0.7)));
  const every = $derived(Math.max(1, Math.ceil(n / Math.max(1, Math.floor((width - L - R) / 70)))));
  const grid = $derived(Array.from({ length: top / step + 1 }, (_, i) => i * step));
  let hover = $state<number | null>(null);
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    hover = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / slot)));
  };
</script>

<div class="chart" bind:clientWidth={width}>
  <svg
    {width}
    height={H}
    viewBox={`0 0 ${width} ${H}`}
    role="img"
    aria-label="Daily spend, peak {fmtCost(mx)}"
    onpointermove={onMove}
    onpointerleave={() => (hover = null)}
  >
    {#each grid as t (t)}
      <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
      {#if Math.abs(y(t) - y(mx)) > 12}<text x={width - R + 8} y={y(t) + 4}>${t}</text>{/if}
    {/each}
    {#each days as d, i (i)}
      {@const x = L + i * slot + (slot - bw) / 2}
      <rect {x} y={y(d.total)} width={bw} height={Math.max(0, y(0) - y(d.total))} fill="var(--accent)" />
      {#if i % every === 0}<text x={x + bw / 2} y={H - 6} text-anchor="middle">{d.label}</text>{/if}
    {/each}
    <line x1={L} x2={width - R + 4} y1={y(mx)} y2={y(mx)} stroke="var(--warn)" stroke-dasharray="4 3" />
    <text class="pk" x={width - R + 8} y={y(mx) + 4}>{fmtCost(mx)}</text>
  </svg>
  {#if hover !== null && days[hover]}
    <div class="tip" style:left={`${Math.max(70, Math.min(width - R - 70, L + (hover + 0.5) * slot))}px`}>
      <span class="m">{days[hover]!.label}</span><b>{fmtCost(days[hover]!.total)}</b>
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
    min-height: 190px;
    padding-top: var(--sp-2);
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
  text.pk {
    fill: var(--warn);
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
</style>
