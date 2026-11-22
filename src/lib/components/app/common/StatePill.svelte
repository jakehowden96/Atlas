<script module lang="ts">
  /** Matches `SessionState` in `src/types/generated/SessionState.ts` (`needsYou` → `needs`). */
  export type PillState = "running" | "needs" | "idle" | "error";
</script>

<script lang="ts">
  import StatusMark, { type MarkState } from "./StatusMark.svelte";

  interface Props {
    state: PillState;
  }

  let { state }: Props = $props();

  const META: Record<PillState, { label: string; colour: string; mark: MarkState }> = {
    running: { label: "Running", colour: "var(--success)", mark: "running" },
    needs: { label: "Needs you", colour: "var(--warning)", mark: "attention" },
    idle: { label: "Idle", colour: "var(--muted-foreground)", mark: "idle" },
    error: { label: "Error", colour: "var(--destructive)", mark: "failing" },
  };

  let meta = $derived(META[state]);
</script>

<span class="pill" style="--pill-colour: {meta.colour}">
  <StatusMark state={meta.mark} />
  {meta.label}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--h-xs);
    padding: 0 8px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--pill-colour) 14%, transparent);
    color: var(--pill-colour);
    font-family: var(--font-sans);
    font-size: var(--text-caption);
    font-weight: 600;
    white-space: nowrap;
  }
</style>
