<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    note?: string | Snippet;
    children: Snippet;
  }

  let { title, note, children }: Props = $props();
</script>

<section class="card">
  <header>
    <h3>{title}</h3>
    {#if typeof note === "string"}
      <span>{note}</span>
    {:else if note}
      <span>{@render note()}</span>
    {/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .card {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5);
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 90%, black);
  }
  h3 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  header span {
    color: var(--muted);
    font-size: var(--fs-2xs);
    text-align: right;
  }
  .body {
    padding: var(--sp-4) var(--sp-5);
  }
</style>
