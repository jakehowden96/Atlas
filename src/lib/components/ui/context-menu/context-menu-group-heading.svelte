<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    ...restProps
  }: ContextMenuPrimitive.GroupHeadingProps & {
    inset?: boolean;
  } = $props();
</script>

<ContextMenuPrimitive.GroupHeading
  bind:ref
  data-slot="context-menu-group-heading"
  data-inset={inset}
  class={cn(
    "px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-[0.06em] uppercase text-muted-foreground data-inset:pl-[34px]",
    className,
  )}
  {...restProps}
/>
