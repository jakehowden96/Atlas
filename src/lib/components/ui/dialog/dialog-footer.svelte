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

<!-- Right-aligned: outline (cancel) then default (confirm). -->
<div
  bind:this={ref}
  data-slot="dialog-footer"
  class={cn("flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3", className)}
  {...restProps}
>
  {@render children?.()}
</div>
