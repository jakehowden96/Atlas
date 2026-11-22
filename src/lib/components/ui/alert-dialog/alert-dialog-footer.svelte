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
  data-slot="alert-dialog-footer"
  class={cn("flex items-center justify-end gap-2 border-t border-border px-4 py-3", className)}
  {...restProps}
>
  {@render children?.()}
</div>
