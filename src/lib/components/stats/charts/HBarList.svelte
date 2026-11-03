<script lang="ts">
  import {
    formatValue,
    medianText,
    pointText,
    roving,
    type Point,
    type Unit,
  } from "../../../stats-chart";
  import { tooltip } from "../../../ui/tooltip";

  interface Props {
    points: Point[];
    unit: Unit;
    label: string;
    emptyText: string;
    onselect?: (key: string) => void;
  }

  let { points, unit, label, emptyText, onselect }: Props = $props();

  const values = $derived(points.map((p) => p.value));
  const max = $derived(Math.max(0, ...values));
  let live = $state("");
  let pinned = $state("");
  const text = (p: Point) =>
    pointText({ ...p, context: p.context ?? medianText(p.value, values) }, unit);
</script>

<div class="list" role="group" aria-label={label} use:roving>
  {#if max === 0}
    <p class="empty">{emptyText}</p>
  {/if}
  {#each points as p (p.key)}
    <button
      type="button"
      class="row"
      data-mark
      tabindex="-1"
      aria-label={text(p)}
      use:tooltip={{ text: text(p), delay: 0, side: "top" }}
      onfocus={() => (live = text(p))}
      onclick={() => {
        pinned = text(p);
        onselect?.(p.key);
      }}
    >
      <span class="name">{p.label}</span>
      <span class="track"
        ><span class="fill" style:width={max ? `${(p.value / max) * 100}%` : "0"}></span></span
      >
      <span class="val">{formatValue(p.value, unit)}</span>
    </button>
  {/each}
  {#if pinned}<p class="pinned">{pinned}</p>{/if}
  <div class="sr" role="status" aria-live="polite">{live}</div>
</div>

<style>
  .list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-0) 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .row:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 1px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    height: var(--sp-3);
    border-bottom: 1px solid var(--border2);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 0 var(--r-xs) var(--r-xs) 0;
  }
  .val {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .empty,
  .pinned {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
