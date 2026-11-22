<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    children: childrenProp,
    closeOnSelect = false,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.RadioItemProps> & {
    inset?: boolean;
  } = $props();
</script>

<ContextMenuPrimitive.RadioItem
  bind:ref
  {closeOnSelect}
  data-slot="context-menu-radio-item"
  data-inset={inset}
  class={cn(
    "group/menu-item relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground *:data-[slot=icon]:text-muted-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:*:data-[slot=icon]:text-destructive data-disabled:pointer-events-none data-disabled:text-muted-foreground data-inset:pl-[34px] pr-8",
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked })}
    <span class="absolute right-2 pointer-events-none">
      {#if checked}
        <Icon name="check" size={16} />
      {/if}
    </span>
    {@render childrenProp?.({ checked })}
  {/snippet}
</ContextMenuPrimitive.RadioItem>
