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

<!-- Scrolls, so a dialog never clips at the 500px minimum window height. -->
<div
  bind:this={ref}
  data-slot="dialog-body"
  class={cn("grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4", className)}
  {...restProps}
>
  {@render children?.()}
</div>
