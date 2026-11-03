<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import MenuButton from "../../lib/components/ui/MenuButton.svelte";
  import { contextMenu } from "../../lib/ui/contextmenu";
  import type { MenuItem } from "../../lib/components/ui/Menu.svelte";

  const plain: MenuItem[] = [
    { id: "a", label: "Open" },
    { id: "b", label: "Rename" },
    { id: "c", label: "Duplicate" },
  ];
  const rich: MenuItem[] = [
    { id: "copy", label: "Copy path", icon: "content_copy", shortcut: "Ctrl C" },
    { id: "edit", label: "Rename", icon: "edit", shortcut: "F2" },
    {
      id: "more",
      label: "More",
      icon: "more_horiz",
      children: [
        { id: "x", label: "Reveal" },
        { id: "y", label: "Pin" },
      ],
    },
    { id: "lock", label: "Move", icon: "folder", disabled: true },
    { id: "del", label: "Delete", icon: "delete", danger: true, separatorBefore: true },
  ];
  let last = $state("none");
  const onselect = (i: MenuItem) => (last = i.label);
</script>

<GallerySection
  title="Menu"
  states={["plain", "icons, shortcuts, separator, danger, disabled, submenu", "context menu"]}
>
  <div class="row">
    <MenuButton label="Actions" items={plain} {onselect} />
    <MenuButton label="Row actions" icon="more_horiz" items={rich} {onselect} />
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="area" tabindex="0" use:contextMenu={{ items: rich, onselect }}>
      Right-click here, or focus and press Shift+F10
    </div>
    <span>Last: {last}</span>
  </div>
</GallerySection>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-5);
  }
  .area {
    padding: var(--sp-7) var(--sp-8);
    border: 1px dashed var(--border2);
    border-radius: var(--r-card);
    font-size: var(--fs-sm);
  }
</style>
