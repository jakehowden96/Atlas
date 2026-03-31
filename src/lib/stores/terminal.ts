import { writable, derived, get } from "svelte/store";
import type { TerminalTab } from "../../types/terminal";

export const tabs = writable<TerminalTab[]>([]);
export const activeTabId = writable<string>("");

export const activeTab = derived([tabs, activeTabId], ([$tabs, $activeTabId]) =>
  $tabs.find((t) => t.id === $activeTabId),
);

export function addTab(tab: TerminalTab) {
  tabs.update((t) => [...t, tab]);
  activeTabId.set(tab.id);
}

export function removeTab(id: string) {
  tabs.update((t) => t.filter((tab) => tab.id !== id));
  const remaining = get(tabs);
  if (remaining.length > 0) {
    activeTabId.set(remaining[remaining.length - 1].id);
  }
}

export function switchToTab(index: number) {
  const t = get(tabs);
  if (index >= 0 && index < t.length) {
    activeTabId.set(t[index].id);
  }
}

export function setTabTitle(id: string, title: string) {
  tabs.update((t) =>
    t.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
  );
}
