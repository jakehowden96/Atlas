<script lang="ts">
  import Sparkline from "../../ui/Sparkline.svelte";
  import { deltaText } from "../../../stats-chart";

  interface Props {
    label: string;
    value: string;
    /** Percent change against `versus`; omit for none. */
    delta?: number;
    versus?: string;
    /** |delta| at or above this colours the delta; below it stays muted. */
    threshold?: number;
    /** Decorative; the delta text carries the meaning. */
    spark?: number[];
  }

  let { label, value, delta, versus = "last week", threshold = 25, spark }: Props = $props();

  const tone = $derived(
    delta === undefined || Math.abs(delta) < threshold ? "" : delta > 0 ? "up" : "down",
  );
</script>

<div class="kpi">
  <span class="label">{label}</span>
  <span class="value">{value}</span>
  {#if delta !== undefined}
    <span class="delta {tone}">{deltaText(delta, versus)}</span>
  {/if}
  {#if spark}<Sparkline values={spark} />{/if}
</div>

<style>
  .kpi {
    display: flex;
    flex-direction: column;
    gap: var(--sp-0);
  }
  .label,
  .delta {
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
  .value {
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    font-weight: var(--fw-semi);
    color: var(--text);
  }
  .delta.up {
    color: var(--accent);
  }
  .delta.down {
    color: var(--warn);
  }
</style>
