<script lang="ts">
  interface Props {
    /** 0..100 */
    value: number;
    /** Letter shown in the pill under the ring. */
    grade?: string;
    /** Names the ring for screen readers, e.g. "Efficiency score". */
    label: string;
  }

  let { value, grade, label }: Props = $props();

  const R = 36;
  const C = 2 * Math.PI * R;
  const pct = $derived(Math.max(0, Math.min(100, value)));
</script>

<div class="ring">
  <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${label}: ${Math.round(pct)} of 100`}>
    <circle class="track" cx="42" cy="42" r={R} />
    <circle class="arc" cx="42" cy="42" r={R} stroke-dasharray={`${(C * pct) / 100} ${C}`} />
  </svg>
  <div class="n">{Math.round(pct)}<small>/100</small></div>
  {#if grade}<span class="g">{grade}</span>{/if}
</div>

<style>
  .ring {
    position: relative;
    flex-shrink: 0;
    width: 84px;
    margin-bottom: var(--sp-3);
    cursor: default;
  }
  svg {
    display: block;
    transform: rotate(-90deg);
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
  .n {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    font-weight: var(--fw-bold);
    line-height: 1;
  }
  .n small {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-body);
  }
  .g {
    position: absolute;
    left: 50%;
    bottom: -11px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border: 2px solid var(--surface);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    box-sizing: border-box;
  }
</style>
