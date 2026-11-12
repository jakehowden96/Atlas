<script lang="ts">
  export interface RankItem {
    key: string;
    title: string;
    sub?: string;
    value?: string;
  }

  interface Props {
    items: RankItem[];
    label: string;
    emptyText?: string;
    /** Makes rows buttons with a chevron. */
    onselect?: (key: string) => void;
    /** Key of the pressed row. */
    active?: string;
  }

  let { items, label, emptyText = "No data", onselect, active }: Props = $props();
</script>

{#snippet body(it: RankItem, i: number)}
  <span class="i">{String(i + 1).padStart(2, "0")}</span>
  <span class="b">
    <b>{it.title}</b>
    {#if it.sub}<span>{it.sub}</span>{/if}
  </span>
  <span class="v"
    >{it.value ?? ""}{#if onselect}<i class="chev">›</i>{/if}</span
  >
{/snippet}

{#if items.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <div aria-label={label} role="group">
    {#each items as it, i (it.key)}
      {#if onselect}
        <button
          type="button"
          class="lrow"
          class:on={active === it.key}
          aria-pressed={active === it.key}
          onclick={() => onselect(it.key)}
        >
          {@render body(it, i)}
        </button>
      {:else}
        <div class="lrow">{@render body(it, i)}</div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .lrow {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    width: 100%;
    padding: var(--sp-3) 0;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
  }
  .lrow:last-child {
    border-bottom: 0;
  }
  div.lrow:hover,
  button.lrow:hover,
  .on {
    background: var(--surface2);
  }
  button.lrow {
    cursor: pointer;
  }
  .on .b b {
    color: var(--accent);
  }
  .i {
    flex-shrink: 0;
    width: 22px;
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
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .b span {
    color: var(--muted);
  }
  .v {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .chev {
    margin-left: var(--sp-3);
    color: var(--muted);
    font-style: normal;
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
