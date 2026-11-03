<script module lang="ts">
  /** A running session whose transcript has been quiet this long is treated as untailed. */
  export const TAIL_STALE_MS = 120_000;

  /** Whole minutes quiet when a running session's tail has stopped updating, else null. */
  export function tailStaleMinutes(
    state: string,
    lastActivity: string | null,
    now: number,
  ): number | null {
    if (state !== "running" || !lastActivity) return null;
    const at = Date.parse(lastActivity);
    if (Number.isNaN(at) || now - at < TAIL_STALE_MS) return null;
    return Math.floor((now - at) / 60_000);
  }
</script>

<script lang="ts">
  import StatusMark from "../../ui/StatusMark.svelte";

  let { minutes }: { minutes: number } = $props();
</script>

<div class="note" role="status">
  <StatusMark state="attention" />
  <span>Transcript stopped updating · {minutes}m</span>
</div>

<style>
  .note {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
    color: var(--warn);
    font-size: var(--fs-xs);
    font-weight: 500;
  }
</style>
