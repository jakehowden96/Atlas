import { writable, derived, get } from "svelte/store";
import type { TerminalTab, MarkdownTab, TabItem } from "../../types/terminal";

export const tabs = writable<TabItem[]>([]);
export const activeTabId = writable<string>("");

export const activeTab = derived([tabs, activeTabId], ([$tabs, $activeTabId]) =>
  $tabs.find((t) => t.id === $activeTabId),
);

export function addTab(tab: TabItem) {
  tabs.update((t) => [...t, tab]);
  activeTabId.set(tab.id);
}

export function addMarkdownTab(title: string, content: string, filePath?: string) {
  const tab: MarkdownTab = {
    type: "markdown",
    id: crypto.randomUUID(),
    title,
    content,
    filePath,
  };
  addTab(tab);
  return tab.id;
}

export function updateMarkdownContent(id: string, content: string) {
  tabs.update((t) =>
    t.map((tab) =>
      tab.id === id && tab.type === "markdown" ? { ...tab, content } : tab,
    ),
  );
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

export function cycleTab(direction: 1 | -1) {
  const t = get(tabs);
  if (t.length < 2) return;
  const currentId = get(activeTabId);
  const currentIndex = t.findIndex((tab) => tab.id === currentId);
  const nextIndex = (currentIndex + direction + t.length) % t.length;
  activeTabId.set(t[nextIndex].id);
}

export function setTabTitle(id: string, title: string) {
  tabs.update((t) =>
    t.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
  );
}
