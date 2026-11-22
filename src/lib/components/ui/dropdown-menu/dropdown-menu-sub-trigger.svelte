<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    children,
    ...restProps
  }: DropdownMenuPrimitive.SubTriggerProps & {
    inset?: boolean;
  } = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
  bind:ref
  data-slot="dropdown-menu-sub-trigger"
  data-inset={inset}
  class={cn(
    "group/menu-item relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground *:data-[slot=icon]:text-muted-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:*:data-[slot=icon]:text-destructive data-disabled:pointer-events-none data-disabled:text-muted-foreground data-inset:pl-[34px] data-[state=open]:bg-accent",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <Icon name="chevron_right" size={16} class="ml-auto" />
</DropdownMenuPrimitive.SubTrigger>
