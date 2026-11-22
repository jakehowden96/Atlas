<script lang="ts">
  /** A shadcn DropdownMenu behind a text Button, or an icon Button when `icon` is set. */
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon, { type IconName } from "$lib/components/ui/icon/icon.svelte";
  import MenuItems from "./MenuItems.svelte";
  import type { MenuItem } from "./menu";

  let {
    items,
    onselect,
    label,
    icon,
    side = "bottom",
    align = "start",
  }: {
    items: MenuItem[];
    onselect?: (item: MenuItem) => void;
    /** Accessible name; also the visible text unless `icon` is set. */
    label: string;
    icon?: IconName;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      {#if icon}
        <Button {...props} variant="ghost" size="icon" aria-label={label} title={label}
          ><Icon name={icon} size={20} /></Button
        >
      {:else}
        <Button {...props} variant="outline" size="sm">{label}</Button>
      {/if}
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content {side} {align} aria-label={label}>
    <MenuItems {items} {onselect} />
  </DropdownMenu.Content>
</DropdownMenu.Root>
