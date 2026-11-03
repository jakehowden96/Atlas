<script lang="ts">
  import type { RailRowData } from "../../../session-view";
  import StatusMark from "../../ui/StatusMark.svelte";

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
    grid-template-columns: 10px 1fr;
    column-gap: 10px;
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
  }

  .title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--fs-sm);
    line-height: 20px;
  }

  .title.muted {
    color: var(--muted);
  }

  .status {
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 18px;
  }

  .word {
    font-weight: 500;
  }

  .word.running {
    color: var(--accent);
  }

  .word.failing {
    color: var(--danger);
  }

  .word.attention {
    color: var(--warn);
  }

  .detail-link {
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .detail-link:hover {
    color: var(--text);
  }

  .meta,
  .action {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 18px;
  }

  .chip {
    margin-left: 6px;
    padding: 0 5px;
    border: 1px solid var(--border2);
    border-radius: var(--r-xs);
    line-height: 16px;
  }

  .action {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
