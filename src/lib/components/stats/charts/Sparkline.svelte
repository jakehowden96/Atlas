<script lang="ts">
  interface Props {
    /** Actual values, one per slot from the left. */
    values: number[];
    /** Slots on the x axis; more than `values.length` leaves room for a forecast. */
    slots?: number;
    /** Dashed forecast from the last value to this value at the last slot. */
    forecast?: number;
    /** Names the chart for screen readers. */
    label: string;
  }

  let { values, slots = values.length, forecast, label }: Props = $props();

  const W = 240;
  const H = 64;
  const top = $derived(Math.max(1e-9, ...values, forecast ?? 0));
  const x = (i: number) => (i / Math.max(1, slots - 1)) * W;
  const y = (v: number) => 4 + (1 - v / top) * (H - 8);
  const line = $derived(values.map((v, i) => `${x(i)},${y(v)}`).join("L"));
  const last = $derived(values.length - 1);
</script>

{#if values.length > 0}
  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
    <path class="area" d={`M${line}L${x(last)},${H}L0,${H}Z`} />
    <path class="line" d={`M${line}`} />
    {#if forecast !== undefined}
      <path class="fc" d={`M${x(last)},${y(values[last]!)}L${x(slots - 1)},${y(forecast)}`} />
    {/if}
  </svg>
{/if}

<style>
  svg {
    display: block;
    width: 100%;
    height: 64px;
    overflow: visible;
  }
  .area {
    fill: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .line,
  .fc {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .fc {
    stroke-dasharray: 3 3;
  }
</style>
