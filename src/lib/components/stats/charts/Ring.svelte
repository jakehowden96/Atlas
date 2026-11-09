<script lang="ts">
  interface Props {
    /** 0..100 */
    value: number;
    /** Names the ring for screen readers, e.g. "Efficiency score". */
    label: string;
    size?: number;
  }

  let { value, label, size = 84 }: Props = $props();

  const STROKE = 7;
  const r = $derived((size - STROKE) / 2);
  const c = $derived(2 * Math.PI * r);
  const pct = $derived(Math.max(0, Math.min(100, value)));
</script>

<div class="ring" style:width={`${size}px`} style:height={`${size}px`}>
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${Math.round(pct)} of 100`}>
    <circle class="track" cx={size / 2} cy={size / 2} {r} />
    <circle
      class="arc"
      cx={size / 2}
      cy={size / 2}
      {r}
      stroke-dasharray={`${(pct / 100) * c} ${c}`}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
    />
  </svg>
  <span class="num"><b>{Math.round(pct)}</b><i>/100</i></span>
</div>

<style>
  .ring {
    position: relative;
    flex-shrink: 0;
  }
  circle {
    fill: none;
    stroke-width: 7;
  }
  .track {
    stroke: var(--surface3);
  }
  .arc {
    stroke: var(--accent);
    stroke-linecap: round;
  }
  .num {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    line-height: 1.1;
  }
  b {
    font-size: var(--fs-xl);
    font-weight: var(--fw-semi);
  }
  i {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-style: normal;
  }
</style>
