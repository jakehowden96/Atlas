<script lang="ts">
  import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="skeleton"
  aria-hidden="true"
  class={cn("block h-3 rounded-xs bg-accent animate-pulse-live", className)}
  {...restProps}
></div>
