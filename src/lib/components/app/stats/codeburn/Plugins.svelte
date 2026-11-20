<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import type { Quota } from "../../../../../types/codeburn-plans";
  import * as Empty from "$lib/components/ui/empty/index.js";
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
        <Empty.Root>
          <Empty.Header>
            <Empty.Media variant="icon"><Icon name="search" size={20} /></Empty.Media>
            <Empty.Title>No providers</Empty.Title>
          </Empty.Header>
        </Empty.Root>
      {:else}
        {#each q.providers as p, i (p.id)}
          <div class="lrow">
            <span class="i">{String(i + 1).padStart(2, "0")}</span>
            <span class="b">
              <b>{p.name}</b>
              <span>Built-in provider</span>
            </span>
            <span class="pill" class:neutral={!p.available}
              >{p.available ? "on" : "not set up"}</span
            >
          </div>
        {/each}
      {/if}
    </Card>
  {/snippet}
</Loader>

<style>
  .sub {
    margin: 0 0 var(--sp-3);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .lrow {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-3) 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--text-caption);
  }
  .lrow:last-child {
    border-bottom: 0;
  }
  .lrow:hover {
    background: var(--muted);
  }
  .i {
    width: 22px;
    flex-shrink: 0;
    color: var(--muted-foreground);
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
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
  }
  .b span {
    color: var(--muted-foreground);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--success) 16%, transparent);
    color: var(--success);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
  }
  .pill.neutral {
    background: var(--accent);
    color: var(--muted-foreground);
  }
</style>
