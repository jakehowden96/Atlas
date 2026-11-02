<script lang="ts">
  /** The ticket block. Phase 70 fills in the linked ticket; until then it is
   *  the empty state, at the height a linked ticket will have. */
  let { branchLine }: { branchLine: string } = $props();
</script>

<div class="ticket">
  <div class="none">No ticket linked</div>
  {#if branchLine}<div class="branch">{branchLine}</div>{/if}
</div>

<style>
  .ticket {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 134px;
    padding: 16px 16px 14px;
    background: var(--surface2);
  }

  .none {
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  .branch {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
</style>
