<script lang="ts">
  import type { Quota } from "../../../../types/codeburn-plans";
  import EmptyState from "../../ui/EmptyState.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";

  let { refresh }: { refresh: number } = $props();
</script>

<!-- codeburn has no plugin concept; its providers (from `quota`) are the closest list. -->
<Loader args={["quota", "--format", "json"]} {refresh}>
  {#snippet children(q: Quota)}
    <Card title="Plugins">
      <p class="sub">No third-party plugins installed. Built-in providers:</p>
      {#if q.providers.length === 0}
        <EmptyState icon="search" title="No providers" />
      {:else}
        <ul>
          {#each q.providers as p (p.id)}
            <li>
              <strong>{p.name}</strong>
              <span class="detail">Built-in provider{p.plan ? ` · ${p.plan}` : ""}</span>
              <span class="pill" class:on={p.available}>{p.available ? "on" : "not set up"}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  {/snippet}
</Loader>

<style>
  .sub {
    margin: 0 0 var(--sp-3);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
    padding: var(--sp-2) 0;
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .detail {
    flex: 1;
    color: var(--muted);
  }
  .pill {
    padding: 0 var(--sp-2);
    border-radius: var(--r-pill);
    background: var(--surface3);
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .pill.on {
    color: var(--text);
  }
</style>
