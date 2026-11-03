import type { MenuItem } from "../ui/Menu.svelte";

/** What was right-clicked: a row, or `null` for the empty space of the tree. */
export interface FileTarget {
  /** True for a row in the workspace docs tree, the only place folders can be made or listed. */
  inWorkspace: boolean;
  isDir: boolean;
}

/** Menu items valid for the target. Nothing here deletes permanently. */
export function fileMenuItems(target: FileTarget | null, hasWorkspace: boolean): MenuItem[] {
  const newItems: MenuItem[] = [
    { id: "new-note", label: "New note", icon: "add", disabled: !hasWorkspace },
    {
      id: "new-folder",
      label: "New folder",
      icon: "folder",
      disabled: !hasWorkspace || (target !== null && !target.inWorkspace),
    },
  ];
  if (!target) return newItems;
  return [
    ...newItems,
    { id: "rename", label: "Rename", shortcut: "F2", separatorBefore: true },
    { id: "copy-path", label: "Copy path" },
    {
      id: "delete",
      label: "Move to trash",
      shortcut: "Delete",
      danger: true,
      separatorBefore: true,
    },
  ];
}
