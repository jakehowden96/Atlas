<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    reveal = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** Show only on row hover or focus-within; repeat these actions in the row's ContextMenu. */
    reveal?: boolean;
  } = $props();
</script>

<div
  bind:this={ref}
  data-slot="item-actions"
  class={cn(
    "ml-auto flex shrink-0 items-center gap-1",
    reveal && "invisible group-focus-within/item:visible group-hover/item:visible",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
