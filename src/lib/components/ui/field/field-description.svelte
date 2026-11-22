<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLParagraphElement>> = $props();
</script>

<p
  bind:this={ref}
  data-slot="field-description"
  class={cn(
    "text-left text-xs leading-4 font-normal text-pretty text-muted-foreground",
    "last:mt-0 nth-last-2:-mt-1",
    "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</p>
