<script lang="ts">
  interface Props {
    values: number[];
    /** Draw the whole line dashed (a projection). */
    dashed?: boolean;
    /** Names the chart for screen readers. */
    label: string;
    /** Hover label per point; falls back to "Point n". */
    labels?: string[];
    /** Hover value format. */
    format?: (v: number) => string;
  }

  let {
    values,
    dashed = false,
    label,
    labels = [],
    format = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  }: Props = $props();

  const W = 300;
  const H = 72;
  const P = 8;
  let hover = $state<number | null>(null);
  const top = $derived(Math.max(1e-9, ...values));
  const pts = $derived(
    values.map((v, i): [number, number] => [
      P + (i / Math.max(1, values.length - 1)) * (W - 2 * P),
      H - 4 - (v / top) * (H - 16),
    ]),
  );
  const line = $derived(`M${pts.map((p) => p.join(",")).join("L")}`);
  const last = $derived(pts[pts.length - 1] ?? ([P, H] as [number, number]));
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    hover = Math.max(
      0,
      Math.min(values.length - 1, Math.round(((x - P) / (W - 2 * P)) * (values.length - 1))),
    );
  };
</script>

{#if values.length > 0}
  <div class="w">
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      onpointermove={onMove}
      onpointerleave={() => (hover = null)}
    >
      <path class="area" d={`${line}L${last[0]},${H}L${P},${H}Z`} />
      <path class="line" class:dashed d={line} />
      {#if hover !== null && pts[hover]}<line
          class="x"
          x1={pts[hover]![0]}
          x2={pts[hover]![0]}
          y1="0"
          y2={H}
        />{/if}
    </svg>
    <i class="dot" style:left={`${(last[0] / W) * 100}%`} style:top={`${(last[1] / H) * 100}%`}></i>
    {#if hover !== null && pts[hover]}
      <div class="tip" style:left={`${Math.max(15, Math.min(85, (pts[hover]![0] / W) * 100))}%`}>
        <span class="m">{labels[hover] ?? `Point ${hover + 1}`}</span><b>{format(values[hover]!)}</b
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  .w {
    position: relative;
    min-width: 0;
    padding: var(--sp-1) 0;
  }
  svg {
    display: block;
    width: 100%;
    height: 72px;
  }
  .area {
    fill: var(--accent);
    fill-opacity: 0.12;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .dashed {
    stroke-dasharray: 4 4;
  }
  .x {
    stroke: var(--text);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    vector-effect: non-scaling-stroke;
  }
  .dot {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--surface);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    bottom: 100%;
    z-index: var(--z-popover);
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-1) var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--elev-1);
    font-size: var(--fs-xs);
    white-space: nowrap;
    transform: translateX(-50%);
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
