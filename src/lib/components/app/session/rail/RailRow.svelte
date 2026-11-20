<script lang="ts">
  import type { RailRowData } from "../../../../session-view";
  import StatusMark from "../../common/StatusMark.svelte";

  let { row }: { row: RailRowData } = $props();
</script>

<div class="row">
  <span class="mark"><StatusMark state={row.state} /></span>
  <div class="text">
    <div class="title" class:muted={row.state === "idle"}>{row.title}</div>
    <div class="status">
      <span class="word {row.state}">{row.word}</span>{row.rest}
    </div>
    {#if row.href}
      <a class="detail-link" href={row.href} target="_blank" rel="noreferrer">{row.linkLabel} →</a>
    {/if}
    {#if row.meta}
      <div class="meta">
        {row.meta}{#if row.chip}<span class="chip">{row.chip}</span>{/if}
      </div>
    {/if}
    {#if row.action}
      <div class="action">{row.action}</div>
    {/if}
  </div>
</div>

<style>
  .row {
    display: grid;
    /* minmax(0, …) so long unbroken text can't widen the row past the tile. */
    grid-template-columns: 10px minmax(0, 1fr);
    column-gap: 10px;
  }

  /* Each line of a row on its own, with room between them. */
  .text {
    display: grid;
    gap: 4px;
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--h-xs);
  }

  .title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-sm);
    line-height: 20px;
  }

  .title.muted {
    color: var(--muted-foreground);
  }

  .status {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: 18px;
  }

  .word {
    font-weight: 500;
  }

  .word.running {
    color: var(--success);
  }

  .word.failing {
    color: var(--destructive);
  }

  .word.attention {
    color: var(--warning);
  }

  .detail-link {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .detail-link:hover {
    color: var(--foreground);
  }

  .meta,
  .action {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 18px;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
  }

  .chip {
    max-width: 100%;
    padding: 0 5px;
    border: 1px solid var(--input);
    border-radius: var(--radius-xs);
    line-height: 16px;
    overflow-wrap: anywhere;
  }

  /* Wrap paths and commands over a few lines rather than cutting them to one. */
  .action {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
</style>
