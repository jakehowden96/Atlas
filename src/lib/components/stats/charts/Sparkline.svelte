<script lang="ts">
  interface Props {
    values: number[];
    /** Draw the whole line dashed (a projection). */
    dashed?: boolean;
    /** Names the chart for screen readers. */
    label: string;
  }

  let { values, dashed = false, label }: Props = $props();

  const W = 300;
  const H = 72;
  const P = 8;
  const top = $derived(Math.max(1e-9, ...values));
  const pts = $derived(
    values.map((v, i): [number, number] => [
      P + (i / Math.max(1, values.length - 1)) * (W - 2 * P),
      H - 4 - (v / top) * (H - 16),
    ]),
  );
  const line = $derived(`M${pts.map((p) => p.join(",")).join("L")}`);
  const last = $derived(pts[pts.length - 1] ?? ([P, H] as [number, number]));
</script>

{#if values.length > 0}
  <div class="w">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path class="area" d={`${line}L${last[0]},${H}L${P},${H}Z`} />
      <path class="line" class:dashed d={line} />
    </svg>
    <i class="dot" style:left={`${(last[0] / W) * 100}%`} style:top={`${(last[1] / H) * 100}%`}></i>
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
</style>
