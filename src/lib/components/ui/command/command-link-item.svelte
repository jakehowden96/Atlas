<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: CommandPrimitive.LinkItemProps = $props();
</script>

<CommandPrimitive.LinkItem
  bind:ref
  data-slot="command-item"
  class={cn(
    "group/command-item relative flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm outline-hidden select-none data-selected:bg-accent *:data-[slot=icon]:text-muted-foreground",
    "data-disabled:pointer-events-none data-disabled:text-muted-foreground",
    className,
  )}
  {...restProps}
/>
