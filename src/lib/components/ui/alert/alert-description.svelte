<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="alert-description"
  class={cn(
    "col-start-1 text-caption text-pretty text-muted-foreground group-has-[>[data-slot=icon]]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
