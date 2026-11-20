<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** Right-aligned muted text, or a snippet (pill, chips) for richer content. */
    note?: string | Snippet;
    /** The design's `.card.flush`: header rule and an inset body with no card padding. */
    flush?: boolean;
    children: Snippet;
  }

  let { title, note, flush = false, children }: Props = $props();
</script>

<section class="card" class:flush>
  <h3 class="label">
    <span>{title}</span>
    {#if typeof note === "string"}
      <small>{note}</small>
    {:else if note}
      <small>{@render note()}</small>
    {/if}
  </h3>
  <div class="body">{@render children()}</div>
</section>

<style>
  .card {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
  }
  .label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    margin: 0 0 var(--sp-3);
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
  }
  .label small {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-normal);
  }
  .flush {
    padding: 0;
    overflow: hidden;
  }
  .flush .label {
    margin: 0;
    padding: var(--sp-4) var(--sp-5);
    border-bottom: 1px solid var(--border);
  }
  .flush .body {
    padding: var(--sp-4) var(--sp-5);
  }
</style>
