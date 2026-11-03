<script module lang="ts">
  export type Model = "opus" | "sonnet" | "haiku";
  export interface Series {
    name: string;
    model: Model;
  }
  export interface Bar {
    key: string;
    label: string;
    /** Tooltip, aria-label and live text for the whole bar. */
    text: string;
    /** One value per series for stacked bars; omit for a single accent bar. */
    parts?: number[];
    value: number;
  }
</script>

<script lang="ts">
  import { formatValue, niceTicks, roving, visibleLabels, type Unit } from "../../../stats-chart";
  import { tooltip } from "../../../ui/tooltip";

  interface Props {
    bars: Bar[];
    series?: Series[];
    unit: Unit;
    label: string;
    emptyText: string;
    onselect?: (key: string) => void;
  }

  let { bars, series, unit, label, emptyText, onselect }: Props = $props();

  const max = $derived(Math.max(0, ...bars.map((b) => b.value)));
  const ticks = $derived(niceTicks(max));
  const top = $derived(ticks[ticks.length - 1] ?? 1);
  const shown = $derived(visibleLabels(bars.length));
  const empty = $derived(max === 0);
  const maxIndex = $derived(bars.findIndex((b) => b.value === max));
  let live = $state("");
  let pinned = $state("");

  function pick(b: Bar) {
    pinned = b.text;
    onselect?.(b.key);
  }
</script>

<div class="chart">
  <div class="y" aria-hidden="true">
    {#each ticks as t (t)}
      <span style:bottom={`${(t / top) * 100}%`}>{formatValue(t, unit, true)}</span>
    {/each}
  </div>
  <div class="plot" role="group" aria-label={label} use:roving>
    {#each ticks as t (t)}
      <i class="grid" class:base={t === 0} style:bottom={`${(t / top) * 100}%`}></i>
    {/each}
    {#if empty}
      <p class="empty">{emptyText}</p>
    {/if}
    <div class="bars">
      {#each bars as b, i (b.key)}
        <div class="col">
          <button
            type="button"
            class="bar"
            class:accent={!series}
            data-mark
            tabindex="-1"
            aria-label={b.text}
            style:height={`${(b.value / top) * 100}%`}
            use:tooltip={{ text: b.text, delay: 0, side: "top" }}
            onfocus={() => (live = b.text)}
            onclick={() => pick(b)}
          >
            {#if i === maxIndex && !empty}
              <span class="max">{formatValue(b.value, unit, true)}</span>
            {/if}
            {#if series && b.parts}
              {#each b.parts as v, s (s)}
                <span class="seg {series[s]?.model}" style:flex-grow={v}>
                  {#if i === bars.length - 1 && v > 0}
                    <span class="name">{series[s]?.name}</span>
                  {/if}
                </span>
              {/each}
            {/if}
          </button>
        </div>
      {/each}
    </div>
  </div>
  <div class="x" aria-hidden="true">
    {#each bars as b, i (b.key)}
      <span>{shown.has(i) ? b.label : ""}</span>
    {/each}
  </div>
  {#if pinned}<p class="pinned">{pinned}</p>{/if}
  <div class="sr" role="status" aria-live="polite">{live}</div>
</div>

<style>
  .chart {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--sp-3);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
  .y,
  .plot {
    position: relative;
    height: 160px;
  }
  .y {
    min-width: var(--sp-8);
  }
  .y span {
    position: absolute;
    right: 0;
    transform: translateY(50%);
  }
  .grid {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--border);
  }
  .grid.base {
    border-top-color: var(--border2);
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    font-family: var(--font-ui);
    color: var(--muted);
  }
  .bars {
    position: absolute;
    inset: 0 var(--sp-9) 0 0;
    display: flex;
    align-items: flex-end;
    gap: var(--sp-1);
  }
  .col {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .bar {
    position: relative;
    width: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: var(--r-xs) var(--r-xs) 0 0;
    display: flex;
    flex-direction: column-reverse;
    background: transparent;
    cursor: pointer;
  }
  .bar.accent {
    background: var(--accent);
  }
  .bar:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 1px;
  }
  .seg {
    position: relative;
    flex-basis: 0;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 40%, transparent);
  }
  .seg.opus {
    background-color: var(--model-opus);
    background-image: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--text) 35%, transparent) 0 2px,
      transparent 2px 6px
    );
  }
  .seg.sonnet {
    background-color: var(--model-sonnet);
    background-image: radial-gradient(
      color-mix(in srgb, var(--text) 45%, transparent) 1px,
      transparent 1.5px
    );
    background-size: 6px 6px;
  }
  .seg.haiku {
    background-color: var(--model-haiku);
    background-image:
      repeating-linear-gradient(
        0deg,
        color-mix(in srgb, var(--text) 35%, transparent) 0 1px,
        transparent 1px 5px
      ),
      repeating-linear-gradient(
        90deg,
        color-mix(in srgb, var(--text) 35%, transparent) 0 1px,
        transparent 1px 5px
      );
  }
  .max {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    padding-bottom: var(--sp-0);
    color: var(--text);
    white-space: nowrap;
  }
  .name {
    position: absolute;
    left: calc(100% + var(--sp-2));
    top: 50%;
    transform: translateY(-50%);
    font-family: var(--font-ui);
    color: var(--text);
    white-space: nowrap;
  }
  .x {
    grid-column: 2;
    display: flex;
    gap: var(--sp-1);
    margin-right: var(--sp-9);
    padding-top: var(--sp-1);
  }
  .x span {
    flex: 1;
    text-align: center;
    white-space: nowrap;
    overflow: visible;
  }
  .pinned {
    grid-column: 2;
    margin: var(--sp-2) 0 0;
    color: var(--text);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
