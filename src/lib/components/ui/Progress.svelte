<script lang="ts">
  interface Props {
    label: string;
    /** Omit for the indeterminate variant. */
    value?: number;
    max?: number;
    /** Mono count text, e.g. "12 / 40". */
    count?: string;
  }

  let { label, value, max = 100, count }: Props = $props();
  const pct = $derived(value === undefined ? 0 : Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div class="wrap">
  <div
    class="bar"
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={value}
  >
    <div
      class="fill"
      class:indet={value === undefined}
      style:width={value === undefined ? undefined : `${pct}%`}
    ></div>
  </div>
  {#if count}<span class="count">{count}</span>{/if}
</div>

<style>
  .wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .bar {
    flex: 1;
    height: var(--sp-0);
    background: var(--surface3);
    border-radius: var(--r-pill);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--dur-base) var(--ease-out);
  }
  .indet {
    width: 40%;
    animation: var(--pulse);
  }
  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
</style>
