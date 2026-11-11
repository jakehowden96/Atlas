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
        {#each q.providers as p, i (p.id)}
          <div class="lrow">
            <span class="i">{String(i + 1).padStart(2, "0")}</span>
            <span class="b">
              <b>{p.name}</b>
              <span>Built-in provider</span>
            </span>
            <span class="pill" class:neutral={!p.available}>{p.available ? "on" : "not set up"}</span>
          </div>
        {/each}
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
  .lrow {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-3) 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .lrow:last-child {
    border-bottom: 0;
  }
  .lrow:hover {
    background: var(--surface2);
  }
  .i {
    width: 22px;
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
  }
  .b {
    flex: 1;
    min-width: 0;
  }
  .b b {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  .b span {
    color: var(--muted);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .pill.neutral {
    background: var(--surface3);
    color: var(--muted);
  }
</style>
