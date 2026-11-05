<script lang="ts">
  import type { Quota } from "../../../../types/codeburn-plans";
  import EmptyState from "../../ui/EmptyState.svelte";
  import Loader from "./Loader.svelte";

  let { refresh }: { refresh: number } = $props();
</script>

<!-- codeburn has no plugin concept; its providers (from `quota`) are the closest list. -->
<Loader args={["quota", "--format", "json"]} {refresh}>
  {#snippet children(q: Quota)}
    {#if q.providers.length === 0}
      <EmptyState icon="search" title="No providers" />
    {:else}
      <ul>
        {#each q.providers as p (p.id)}
          <li>
            <strong>{p.name}</strong>
            <span>{p.available ? "available" : "not set up"}{p.plan ? ` · ${p.plan}` : ""}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</Loader>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    justify-content: space-between;
    padding: var(--sp-2) 0;
    border-bottom: 1px solid var(--border);
  }
  span {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
