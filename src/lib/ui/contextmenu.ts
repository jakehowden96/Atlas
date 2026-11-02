import { mount, unmount } from "svelte";
import Menu, { type MenuItem } from "../components/ui/Menu.svelte";

export interface ContextMenuParams {
  items: MenuItem[];
  onselect?: (item: MenuItem) => void;
}

/** `use:contextMenu={{ items, onselect }}`: right-click opens at the pointer, Shift+F10 / the Menu key at the element. */
export function contextMenu(node: HTMLElement, initial: ContextMenuParams) {
  let params = initial;
  let close: (() => void) | undefined;

  function openAt(trigger: HTMLElement, virtual: boolean) {
    close?.();
    const prev = document.activeElement as HTMLElement | null;
    const instance = mount(Menu, {
      target: document.body,
      props: {
        open: true,
        trigger,
        items: params.items,
        onselect: params.onselect,
        // Defer so Popover's own cleanup (focus return) has run before we unmount.
        onclose: () => queueMicrotask(() => close?.()),
      },
    });
    close = () => {
      close = undefined;
      unmount(instance);
      if (virtual) {
        trigger.remove();
        (prev?.isConnected ? prev : node).focus?.();
      }
    };
  }

  const onContext = (e: MouseEvent) => {
    if (!params.items.length) return;
    e.preventDefault();
    const a = document.createElement("div");
    a.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:0;height:0`;
    document.body.append(a);
    openAt(a, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!params.items.length) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openAt(node, false);
    }
  };

  node.addEventListener("contextmenu", onContext);
  node.addEventListener("keydown", onKey);
  return {
    update(next: ContextMenuParams) {
      params = next;
    },
    destroy() {
      node.removeEventListener("contextmenu", onContext);
      node.removeEventListener("keydown", onKey);
      close?.();
    },
  };
}
