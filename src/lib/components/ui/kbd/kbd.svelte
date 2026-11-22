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

<!-- One style. Inside a Tooltip or a default Button it turns transparent and takes currentColor. -->
<kbd
  bind:this={ref}
  data-slot="kbd"
  class={cn(
    "pointer-events-none inline-grid h-5 min-w-5 place-items-center rounded-xs border border-b-2 border-input bg-card px-[5px] font-mono text-xs leading-none font-normal whitespace-nowrap text-muted-foreground select-none",
    "in-data-[slot=tooltip-content]:h-[18px] in-data-[slot=tooltip-content]:min-w-[18px] in-data-[slot=tooltip-content]:border-primary-foreground/35 in-data-[slot=tooltip-content]:bg-transparent in-data-[slot=tooltip-content]:text-current",
    "in-data-[variant=default]:border-primary-foreground/35 in-data-[variant=default]:bg-transparent in-data-[variant=default]:text-current",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</kbd>
