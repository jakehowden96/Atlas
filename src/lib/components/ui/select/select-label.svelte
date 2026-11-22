<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {} = $props();
</script>

<div
  bind:this={ref}
  data-slot="select-label"
  class={cn(
    "px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-[0.06em] uppercase text-muted-foreground data-inset:pl-[34px]",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
