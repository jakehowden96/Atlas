import { writable, derived, get } from "svelte/store";
import type { Terminal } from "@xterm/xterm";
import type { MarkdownTab, TabItem } from "../../types/terminal";

export const tabs = writable<TabItem[]>([]);
export const activeTabId = writable<string>("");

export const activeTab = derived([tabs, activeTabId], ([$tabs, $activeTabId]) =>
  $tabs.find((t) => t.id === $activeTabId),
);

export function addTab(tab: TabItem) {
  tabs.update((t) => [...t, tab]);
  activeTabId.set(tab.id);
}

/** Create a terminal tab pre-configured with a working directory. */
export function createTerminalTabWithCwd(terminal: Terminal, cwd: string): string {
  const id = crypto.randomUUID();
  addTab({ type: "terminal", id, title: "", ptyId: -1, terminal, cwd });
  return id;
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
  } else {
    activeTabId.set("");
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

const titleTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setTabTitle(id: string, title: string) {
  const existing = titleTimers.get(id);
  if (existing) clearTimeout(existing);
  titleTimers.set(id, setTimeout(() => {
    titleTimers.delete(id);
    tabs.update((t) =>
      t.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
    );
  }, 100));
}

export function setTabReady(id: string) {
  tabs.update((t) =>
    t.map((tab) =>
      tab.id === id && tab.type === "terminal" ? { ...tab, ready: true } : tab,
    ),
  );
}

export function setTabNeedsInput(id: string, needsInput: boolean) {
  const t = get(tabs);
  const tab = t.find((x) => x.id === id);
  if (!tab || tab.type !== "terminal" || tab.needsInput === needsInput) return;
  tabs.update((arr) =>
    arr.map((x) =>
      x.id === id && x.type === "terminal" ? { ...x, needsInput } : x,
    ),
  );
}

/** Return tab IDs grouped by workspace cwd. Tabs with no cwd go under "". */
export function getTabsByWorkspace(): Map<string, TabItem[]> {
  const t = get(tabs);
  const groups = new Map<string, TabItem[]>();
  for (const tab of t) {
    const key = (tab.type === "terminal" ? tab.cwd : undefined) ?? "";
    const list = groups.get(key) ?? [];
    list.push(tab);
    groups.set(key, list);
  }
  return groups;
}
