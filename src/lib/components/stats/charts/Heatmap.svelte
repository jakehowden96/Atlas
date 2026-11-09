<script lang="ts">
  import { heatColor, heatLegend, heatStep, roving, type Point } from "../../../stats-chart";
  import { tooltip } from "../../../ui/tooltip";

  interface Props {
    /** One cell per day, in order, 7 per column. `label` reads "Tue 14 Oct". */
    cells: Point[];
    /** Singular noun for the value: "session". */
    noun: string;
    label: string;
    emptyText: string;
    onselect?: (key: string) => void;
    /** Fills its container width, adds month labels, outlines the last cell, drops the side text. */
    compact?: boolean;
  }

  let { cells, noun, label, emptyText, onselect, compact = false }: Props = $props();

  const max = $derived(Math.max(0, ...cells.map((c) => c.value)));
  const peak = $derived(
    compact ? cells[cells.length - 1] : max > 0 ? cells.find((c) => c.value === max) : undefined,
  );
  const cols = $derived(compact ? `repeat(${Math.ceil(cells.length / 7)}, minmax(0, 1fr))` : undefined);
  /** Month name over the first column that starts in it; cell keys are YYYY-MM-DD. */
  const months = $derived.by(() => {
    const out: { col: number; name: string }[] = [];
    let last = "";
    for (let col = 0; col * 7 < cells.length; col++) {
      const key = cells.slice(col * 7, col * 7 + 7).find((c) => !c.key.startsWith("pad"))?.key;
      if (!key || key.slice(0, 7) === last) continue;
      last = key.slice(0, 7);
      out.push({
        col,
        name: new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: "short" }),
      });
    }
    return out;
  });
  const legend = $derived(heatLegend(max));
  const text = (c: Point) => `${c.label}, ${c.value} ${noun}${c.value === 1 ? "" : "s"}`;
  let live = $state("");
  let pinned = $state("");
</script>

<div class="wrap" class:compact>
  {#if compact}
    <div class="months" aria-hidden="true" style:grid-template-columns={cols}>
      {#each months as m (m.col)}<span style:grid-column={m.col + 1}>{m.name}</span>{/each}
    </div>
  {/if}
  <div
    class="grid"
    role="group"
    aria-label={label}
    style:grid-template-columns={cols}
    use:roving={{ h: 7, v: 1 }}
  >
    {#each cells as c (c.key)}
      <button
        type="button"
        class="cell"
        class:peak={c === peak}
        data-mark
        tabindex="-1"
        aria-label={text(c)}
        style:background={heatColor(heatStep(c.value, max))}
        use:tooltip={{ text: text(c), delay: 0, side: "top" }}
        onfocus={() => (live = text(c))}
        onclick={() => {
          pinned = text(c);
          onselect?.(c.key);
        }}
      ></button>
    {/each}
  </div>
  <div class="side" hidden={compact}>
    {#if peak}
      <p>Busiest: {text(peak)}</p>
    {:else}
      <p>{emptyText}</p>
    {/if}
    {#if pinned}<p>{pinned}</p>{/if}
    <div class="legend" role="group" aria-label="Legend">
      {#each legend as l, i (i)}
        <span class="step"><i style:background={heatColor(i)}></i>{l}</span>
      {/each}
    </div>
  </div>
  <div class="sr" role="status" aria-live="polite">{live}</div>
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
    align-items: flex-start;
  }
  .grid {
    display: grid;
    grid-template-rows: repeat(7, var(--sp-5));
    grid-auto-flow: column;
    grid-auto-columns: var(--sp-5);
    gap: var(--sp-0);
  }
  .compact {
    display: block;
  }
  .compact .grid {
    grid-template-rows: repeat(7, var(--sp-4));
  }
  .months {
    display: grid;
    margin-bottom: var(--sp-1);
    color: var(--muted);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
  .side[hidden] {
    display: none;
  }
  .cell {
    padding: 0;
    border: 0;
    border-radius: var(--r-xs);
    cursor: pointer;
  }
  .cell.peak {
    box-shadow: 0 0 0 1px var(--text);
  }
  .cell:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 1px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--text);
  }
  .side p {
    margin: 0;
  }
  .legend {
    display: flex;
    gap: var(--sp-3);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .step i {
    width: var(--sp-4);
    height: var(--sp-4);
    border-radius: var(--r-xs);
    box-shadow: inset 0 0 0 1px var(--border2);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
