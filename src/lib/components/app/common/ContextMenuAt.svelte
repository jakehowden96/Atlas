<script lang="ts">
  /** The `use:contextMenu` surface: a shadcn DropdownMenu opened at an anchor element, no trigger. */
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import MenuItems from "./MenuItems.svelte";
  import type { MenuItem } from "./menu";

  let {
    anchor,
    items,
    onselect,
    onclose,
  }: {
    anchor: HTMLElement;
    items: MenuItem[];
    onselect?: (item: MenuItem) => void;
    onclose: () => void;
  } = $props();
  let open = $state(true);
</script>

<DropdownMenu.Root bind:open onOpenChange={(o) => !o && onclose()}>
  <DropdownMenu.Content
    customAnchor={anchor}
    align="start"
    onCloseAutoFocus={(e) => e.preventDefault()}
  >
    <MenuItems {items} {onselect} />
  </DropdownMenu.Content>
</DropdownMenu.Root>
