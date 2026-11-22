<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    ...restProps
  }: ComponentProps<typeof DropdownMenuPrimitive.GroupHeading> & {
    inset?: boolean;
  } = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
  bind:ref
  data-slot="dropdown-menu-group-heading"
  data-inset={inset}
  class={cn(
    "px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-[0.06em] uppercase text-muted-foreground data-inset:pl-[34px]",
    className,
  )}
  {...restProps}
/>
