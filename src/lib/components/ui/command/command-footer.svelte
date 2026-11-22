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

<!-- Hint row: "↑↓ move · ⏎ open · Esc close". -->
<div
  bind:this={ref}
  data-slot="command-footer"
  class={cn(
    "flex shrink-0 flex-wrap items-center gap-3.5 border-t border-border px-3.5 py-2 text-xs text-muted-foreground *:flex *:items-center *:gap-1",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
