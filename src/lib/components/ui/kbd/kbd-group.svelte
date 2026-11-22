<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<span
  bind:this={ref}
  data-slot="kbd-group"
  class={cn("inline-flex items-center gap-0.5", className)}
  {...restProps}
>
  {@render children?.()}
</span>
