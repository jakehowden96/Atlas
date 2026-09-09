<script module lang="ts">
  /** Matches `SessionState` in `src/types/session.ts` (`needsYou` → `needs`). */
  export type PillState = "running" | "needs" | "idle" | "error";
</script>

<script lang="ts">
  interface Props {
    state: PillState;
  }

  let { state }: Props = $props();

  const META: Record<PillState, { label: string; colour: string }> = {
    running: { label: "Running", colour: "var(--accent)" },
    needs: { label: "Needs you", colour: "var(--warn)" },
    idle: { label: "Idle", colour: "var(--muted)" },
    error: { label: "Error", colour: "var(--danger)" },
  };

  let meta = $derived(META[state]);
</script>

<span
  class="pill"
  style="--pill-colour: {meta.colour}"
>
  {#if state === "running"}<span class="dot"></span>{/if}
  {meta.label}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--pill-colour) 14%, transparent);
    color: var(--pill-colour);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  .dot {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--pill-colour);
    animation: atlasPulse 1.6s ease-in-out infinite;
  }
</style>
