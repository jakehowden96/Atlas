<script lang="ts">
  import { formatValue, niceTicks, type Unit } from "../../../stats-chart";
  import { tooltip } from "../../../ui/tooltip";
  import type { TrendDay, TrendSeries } from "../codeburn/overview-derive";

  interface Props {
    days: TrendDay[];
    /** Models to stack per day; empty draws one bar per day. */
    series?: TrendSeries[];
    unit: Unit;
    /** Names the chart for screen readers. */
    label: string;
    /** Index of the bar drawn in the accent colour. */
    accentIndex?: number;
  }

  let { days, series = [], unit, label, accentIndex = days.length - 1 }: Props = $props();

  const peak = $derived(Math.max(0, ...days.map((d) => d.total)));
  const ticks = $derived(niceTicks(peak));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const text = (d: TrendDay) => `${d.label}: ${formatValue(d.total, unit)}`;
  // Few labels, evenly spaced: the bars are too narrow for one each.
  const labelled = $derived(
    new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (days.length - 1)) / 4))),
  );
</script>

{#if days.length === 0 || peak === 0}
  <p class="empty">No spend yet</p>
{:else}
  <div class="chart">
    <div class="plot">
      <div class="bars" role="group" aria-label={label}>
        {#each days as d, i (d.key)}
          <span
            class="bar"
            role="img"
            aria-label={text(d)}
            use:tooltip={{ text: text(d), delay: 0, side: "top" }}
          >
            {#if series.length > 0}
              {#each series as s (s.id)}
                {#if d.parts[s.id]}
                  <i style:height={`${(d.parts[s.id]! / top) * 100}%`} style:background={s.color}></i>
                {/if}
              {/each}
            {:else}
              <i class:accent={i === accentIndex} style:height={`${(d.total / top) * 100}%`}></i>
            {/if}
          </span>
        {/each}
      </div>
      <div class="peak" style:bottom={`${(peak / top) * 100}%`}>
        <span>{formatValue(peak, unit)}</span>
      </div>
    </div>
    <div class="axis" aria-hidden="true">
      {#each ticks as t (t)}
        <span style:bottom={`${(t / top) * 100}%`}>{formatValue(t, unit, true)}</span>
      {/each}
    </div>
    <div class="x" aria-hidden="true">
      {#each days as d, i (d.key)}
        {#if labelled.has(i)}<span style:left={`${((i + 0.5) / days.length) * 100}%`}>{d.label}</span>{/if}
      {/each}
    </div>
  </div>
  {#if series.length > 0}
    <ul class="legend" aria-label="Models">
      {#each series as s (s.id)}
        <li><i style:background={s.color}></i>{s.label}</li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .chart {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px;
    grid-template-rows: 140px var(--sp-6);
    column-gap: var(--sp-3);
  }
  .plot {
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 100%;
  }
  .bar {
    display: flex;
    flex: 1;
    flex-direction: column-reverse;
    justify-content: flex-start;
    height: 100%;
    min-width: 0;
  }
  .bar i {
    display: block;
    min-height: 1px;
    background: var(--surface3);
  }
  .bar i.accent {
    background: var(--accent);
  }
  .peak {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--border2);
    pointer-events: none;
  }
  .peak span {
    position: absolute;
    left: 100%;
    margin-left: var(--sp-3);
    transform: translateY(-50%);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .axis {
    position: relative;
  }
  .axis span {
    position: absolute;
    left: var(--sp-3);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    transform: translateY(50%);
  }
  .x {
    position: relative;
    grid-column: 1;
  }
  .x span {
    position: absolute;
    top: var(--sp-2);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    transform: translateX(-50%);
    white-space: nowrap;
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
</style>
