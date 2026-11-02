<script lang="ts">
  import type { SessionTile } from "../../../overview";
  import { branchLine, waitingSummary } from "../../../session-view";
  import MeterStrip from "./MeterStrip.svelte";
  import RailTicket from "./RailTicket.svelte";

  let { tile, now }: { tile: SessionTile | null; now: number } = $props();

  let live = $derived(tile?.live ?? null);
  let waiting = $derived(tile?.state === "needsYou");
</script>

<div class="header">
  {#if waiting}
    <div class="waiting">Waiting for you: {waitingSummary(live?.pendingTool ?? null)}</div>
  {/if}
  <RailTicket branchLine={branchLine(tile?.branch || live?.gitBranch, live?.worktree ?? null)} />
  <MeterStrip {live} {now} />
</div>

<style>
  .header {
    flex-shrink: 0;
  }

  .waiting {
    overflow: hidden;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
    color: var(--warn);
    font-size: var(--fs-xs);
    font-weight: 500;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
