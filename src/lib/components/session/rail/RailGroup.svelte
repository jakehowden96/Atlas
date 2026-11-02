<script lang="ts">
  import type { RailRowData } from "../../../session-view";
  import Icon from "../../ui/Icon.svelte";
  import StatusMark from "../../ui/StatusMark.svelte";
  import RailRow from "./RailRow.svelte";

  interface Props {
    rows: RailRowData[];
    /** Completes "+n more": running, next. Ignored for a fold. */
    noun?: string;
    /** A fold hides its rows behind a `n done` toggle, closed by default. */
    fold?: string;
  }

  let { rows, noun = "", fold }: Props = $props();

  const LIMIT = 3;
  // Local on purpose: neither the fold nor "+n more" outlives the view.
  let expanded = $state(false);
  let shown = $derived(expanded ? rows : rows.slice(0, LIMIT));
</script>

{#if rows.length > 0}
  {#if fold}
    <div class="group">
      <button type="button" class="toggle" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
        <span class="mark"><StatusMark state="done" /></span>
        <span>{rows.length} {fold}</span>
        <span class="twisty" class:open={expanded}><Icon name="chevron_right" /></span>
      </button>
      {#if expanded}
        {#each rows as row, i (i)}<RailRow {row} />{/each}
      {/if}
    </div>
  {:else}
    <div class="group">
      {#each shown as row, i (i)}<RailRow {row} />{/each}
      {#if rows.length > LIMIT}
        <button type="button" class="more" onclick={() => (expanded = !expanded)}>
          {expanded ? "show fewer" : `+${rows.length - LIMIT} more ${noun}`}
        </button>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .group {
    display: grid;
    gap: 10px;
  }

  .toggle,
  .more {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    line-height: 18px;
    text-align: left;
    cursor: pointer;
  }

  .more {
    padding-left: 20px;
  }

  .mark {
    display: flex;
    justify-content: center;
    width: 10px;
  }

  .twisty {
    display: flex;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .twisty.open {
    transform: rotate(90deg);
  }
</style>
