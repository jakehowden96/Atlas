import type { Terminal } from "@xterm/xterm";
import { derived, get, writable } from "svelte/store";
import type { TabItem } from "../../types/terminal";
import { panelData } from "./panel";
import { activeWorkspacePath } from "./workspace";

export const tabs = writable<TabItem[]>([]);
export const activeTabId = writable<string>("");

export const activeTab = derived([tabs, activeTabId], ([$tabs, $activeTabId]) =>
  $tabs.find((t) => t.id === $activeTabId),
);

/** Extract the workspace path from a tab. */
export function getTabWorkspacePath(tab: TabItem): string {
  return tab.cwd ?? "";
}

export function addTab(tab: TabItem, opts?: { activate?: boolean }) {
  tabs.update((t) => [...t, tab]);
  if (opts?.activate !== false) activeTabId.set(tab.id);
}

/** Create a terminal tab pre-configured with a working directory. */
export function createTerminalTabWithCwd(terminal: Terminal, cwd: string): string {
  const id = crypto.randomUUID();
  addTab({ type: "terminal", id, title: "", ptyId: -1, terminal, cwd });
  return id;
}

const titleTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function removeTab(id: string) {
  const pendingTitle = titleTimers.get(id);
  if (pendingTitle) {
    clearTimeout(pendingTitle);
    titleTimers.delete(id);
  }

  const wasActive = get(activeTabId) === id;
  const removedTab = get(tabs).find((t) => t.id === id);
  const removedWs = removedTab ? getTabWorkspacePath(removedTab) : "";

  tabs.update((t) => t.filter((tab) => tab.id !== id));

  if (wasActive) {
    const remaining = get(tabs);
    // Prefer falling back to another tab in the same workspace
    const sameWsTabs = remaining.filter((t) => getTabWorkspacePath(t) === removedWs);
    if (sameWsTabs.length > 0) {
      activeTabId.set(sameWsTabs[sameWsTabs.length - 1].id);
    } else if (remaining.length > 0) {
      const fallback = remaining[remaining.length - 1];
      activeTabId.set(fallback.id);
      // Sync workspace to match the cross-workspace fallback tab
      const fallbackWs = getTabWorkspacePath(fallback);
      if (fallbackWs) {
        activeWorkspacePath.set(fallbackWs);
      }
    } else {
      activeTabId.set("");
    }
    panelData.set(null);
  }
}

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
    t.map((tab) => (tab.id === id ? { ...tab, ready: true } : tab)),
  );
}

export function setTabNeedsInput(id: string, needsInput: boolean) {
  const t = get(tabs);
  const tab = t.find((x) => x.id === id);
  if (!tab || tab.needsInput === needsInput) return;
  tabs.update((arr) =>
    arr.map((x) => (x.id === id ? { ...x, needsInput } : x)),
  );
}

/** Return tabs grouped by workspace cwd. Tabs with no cwd go under "". */
export function getTabsByWorkspace(): Map<string, TabItem[]> {
  const t = get(tabs);
  const groups = new Map<string, TabItem[]>();
  for (const tab of t) {
    const key = getTabWorkspacePath(tab);
    const list = groups.get(key) ?? [];
    list.push(tab);
    groups.set(key, list);
  }
  return groups;
}
