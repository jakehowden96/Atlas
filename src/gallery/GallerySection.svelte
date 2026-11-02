<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    states = [],
    children,
  }: { title: string; states?: string[]; children: Snippet } = $props();
</script>

<section class="section">
  <h2>{title}</h2>
  {#if states.length}
    <p class="states">States: {states.join(", ")}</p>
  {/if}
  <div class="body">{@render children()}</div>
</section>

<style>
  .section {
    margin-bottom: 40px;
  }
  h2 {
    font-size: var(--fs-xl);
    font-weight: var(--fw-semi);
    margin: 0 0 4px;
  }
  .states {
    color: var(--muted);
    font-size: var(--fs-xs);
    margin: 0 0 16px;
  }
  .body {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    padding: 16px;
  }
</style>
