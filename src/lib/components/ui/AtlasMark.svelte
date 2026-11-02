<script lang="ts">
  interface Props {
    size?: 20 | 40;
    label?: string;
  }

  let { size = 20, label }: Props = $props();
</script>

<svg
  class="mark"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  <rect width="20" height="20" rx="5" fill="var(--ink)" />
  <g fill="var(--ink-text)">
    <rect x="4" y="4" width="5" height="5" rx="1" />
    <rect x="11" y="4" width="5" height="5" rx="1" />
    <rect x="4" y="11" width="5" height="5" rx="1" />
  </g>
</svg>

<style>
  .mark {
    flex: none;
    display: block;
  }
</style>
