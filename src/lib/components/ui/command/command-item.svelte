<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: CommandPrimitive.ItemProps = $props();
</script>

<CommandPrimitive.Item
  bind:ref
  data-slot="command-item"
  class={cn(
    "group/command-item relative flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm outline-hidden select-none data-selected:bg-accent *:data-[slot=icon]:text-muted-foreground",
    "data-disabled:pointer-events-none data-disabled:text-muted-foreground",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <Icon
    name="check"
    size={16}
    class="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100"
  />
</CommandPrimitive.Item>
