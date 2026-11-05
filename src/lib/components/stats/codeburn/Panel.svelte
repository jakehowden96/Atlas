<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** Muted caption beside the title. */
    note?: string;
    /** Shows "No data" instead of the body. */
    empty?: boolean;
    children: Snippet;
  }

  let { title, note, empty = false, children }: Props = $props();
</script>

<section class="panel">
  <header>
    <h3>{title}</h3>
    {#if note}<span>{note}</span>{/if}
  </header>
  {#if empty}
    <p class="empty">No data</p>
  {:else}
    {@render children()}
  {/if}
</section>

<style>
  .panel {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    margin-bottom: var(--sp-3);
  }
  h3 {
    margin: 0;
    color: var(--accent);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  header span {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
