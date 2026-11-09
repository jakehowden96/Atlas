<script lang="ts">
  import Icon from "../../ui/Icon.svelte";

  export interface RankItem {
    key: string;
    title: string;
    sub?: string;
    value: string;
  }

  interface Props {
    items: RankItem[];
    label: string;
    emptyText?: string;
    /** Makes rows buttons and shows the chevron. */
    onselect?: (key: string) => void;
  }

  let { items, label, emptyText = "No data", onselect }: Props = $props();
</script>

{#snippet body(it: RankItem, i: number)}
  <span class="idx">{String(i + 1).padStart(2, "0")}</span>
  <span class="main">
    <span class="title">{it.title}</span>
    {#if it.sub}<span class="sub">{it.sub}</span>{/if}
  </span>
  <span class="val">{it.value}</span>
{/snippet}

{#if items.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <ol aria-label={label}>
    {#each items as it, i (it.key)}
      <li>
        {#if onselect}
          <button type="button" class="row" onclick={() => onselect(it.key)}>
            {@render body(it, i)}
            <Icon name="chevron_right" size={16} />
          </button>
        {:else}
          <div class="row">{@render body(it, i)}</div>
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-2) 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
  }
  button.row:hover .title {
    color: var(--accent);
  }
  .idx {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    overflow: hidden;
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .val {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
