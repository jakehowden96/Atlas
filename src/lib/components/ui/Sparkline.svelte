<script lang="ts">
  interface Props {
    values: number[];
  }

  let { values }: Props = $props();

  // One size, one colour: the KPI row is the only thing that draws these.
  const width = 64;
  const height = 20;

  // 1px of headroom top and bottom keeps the 1.5px stroke inside the box.
  let points = $derived.by(() => {
    if (values.length === 0) return "";
    const max = Math.max(...values) || 1;
    const span = values.length > 1 ? values.length - 1 : 1;
    return values
      .map((v, i) => `${(i / span) * width},${height - 1 - (v / max) * (height - 2)}`)
      .join(" ");
  });
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
  <polyline
    {points}
    fill="none"
    stroke="var(--accent)"
    stroke-width="1.5"
    stroke-linejoin="round"
    stroke-linecap="round"
  />
</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
    overflow: visible;
  }
</style>
