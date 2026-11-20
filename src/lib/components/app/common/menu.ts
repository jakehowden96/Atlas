import type { IconName } from "$lib/components/ui/icon/icon.svelte";

/** One row of a data-driven menu (MenuButton, `use:contextMenu`). */
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  /** One level of submenu. */
  children?: MenuItem[];
}
