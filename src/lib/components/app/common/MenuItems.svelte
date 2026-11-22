<script lang="ts">
  /** Renders MenuItem[] as shadcn DropdownMenu rows; goes inside DropdownMenu.Content. */
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import type { MenuItem } from "./menu";
  import Self from "./MenuItems.svelte";

  let { items, onselect }: { items: MenuItem[]; onselect?: (item: MenuItem) => void } = $props();
</script>

{#each items as item (item.id)}
  {#if item.separatorBefore}<DropdownMenu.Separator />{/if}
  {#if item.children?.length}
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger disabled={item.disabled}>
        {#if item.icon}<Icon name={item.icon} />{/if}{item.label}
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent><Self items={item.children} {onselect} /></DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  {:else}
    <DropdownMenu.Item
      disabled={item.disabled}
      variant={item.danger ? "destructive" : "default"}
      onSelect={() => onselect?.(item)}
    >
      {#if item.icon}<Icon name={item.icon} />{/if}{item.label}
      {#if item.shortcut}<DropdownMenu.Shortcut>{item.shortcut}</DropdownMenu.Shortcut>{/if}
    </DropdownMenu.Item>
  {/if}
{/each}
