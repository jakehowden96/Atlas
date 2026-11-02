<script lang="ts">
  import MenuButton from "../components/ui/MenuButton.svelte";
  import { contextMenu } from "../ui/contextmenu";
  import type { MenuItem } from "../components/ui/Menu.svelte";

  let { onselect }: { onselect: (item: MenuItem) => void } = $props();

  const items: MenuItem[] = [
    { id: "open", label: "Open", shortcut: "Enter" },
    { id: "rename", label: "Rename" },
    { id: "share", label: "Share", children: [{ id: "link", label: "Copy link" }, { id: "mail", label: "Email" }] },
    { id: "lock", label: "Locked", disabled: true },
    { id: "delete", label: "Delete", danger: true, separatorBefore: true },
  ];
</script>

<MenuButton label="Actions" {items} {onselect} />
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div use:contextMenu={{ items, onselect }} tabindex="0" data-testid="area">Area</div>
<div use:contextMenu={{ items: [], onselect }} data-testid="empty">Empty</div>
