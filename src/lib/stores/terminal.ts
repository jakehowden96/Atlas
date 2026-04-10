import { writable, derived, get } from "svelte/store";
import type { Terminal } from "@xterm/xterm";
import type { MarkdownTab, TabItem } from "../../types/terminal";
import { panelData } from "./panel";
import { activeWorkspacePath } from "./workspace";

export const tabs = writable<TabItem[]>([]);
export const activeTabId = writable<string>("");

export const activeTab = derived([tabs, activeTabId], ([$tabs, $activeTabId]) =>
  $tabs.find((t) => t.id === $activeTabId),
);

/** Extract the workspace path from any TabItem. */
export function getTabWorkspacePath(tab: TabItem): string {
  if (tab.type === "terminal") return tab.cwd ?? "";
  if (tab.type === "markdown") return tab.workspacePath ?? "";
  return "";
}

/** Tabs filtered to the currently active workspace. */
export const activeWorkspaceTabs = derived(
  [tabs, activeWorkspacePath],
  ([$tabs, $activeWorkspacePath]) => {
    if (!$activeWorkspacePath) return $tabs.filter((t) => !getTabWorkspacePath(t));
    return $tabs.filter((t) => getTabWorkspacePath(t) === $activeWorkspacePath);
  },
);

/** Tracks the last active tab ID per workspace path. */
export const lastActiveTabByWorkspace = writable<Map<string, string>>(new Map());

// Update lastActiveTabByWorkspace whenever the active tab changes
activeTabId.subscribe((id) => {
  if (!id) return;
  const t = get(tabs);
  const tab = t.find((x) => x.id === id);
  if (!tab) return;
  const wsPath = getTabWorkspacePath(tab);
  if (!wsPath) return;
  lastActiveTabByWorkspace.update((m) => {
    const next = new Map(m);
    next.set(wsPath, id);
    return next;
  });
});

// Auto-restore the correct tab when the active workspace changes
activeWorkspacePath.subscribe((path) => {
  if (!path) return;
  const currentId = get(activeTabId);
  const t = get(tabs);
  const currentTab = t.find((x) => x.id === currentId);
  // If the active tab already belongs to the new workspace, keep it
  if (currentTab && getTabWorkspacePath(currentTab) === path) return;
  // Restore last active tab for this workspace
  const lastTab = get(lastActiveTabByWorkspace).get(path);
  if (lastTab && t.some((x) => x.id === lastTab)) {
    activeTabId.set(lastTab);
    return;
  }
  // Fallback to first tab in this workspace
  const wsTabs = t.filter((x) => getTabWorkspacePath(x) === path);
  if (wsTabs.length > 0) {
    activeTabId.set(wsTabs[0].id);
  }
});

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

export function addMarkdownTab(title: string, content: string, filePath?: string, workspacePath?: string) {
  const tab: MarkdownTab = {
    type: "markdown",
    id: crypto.randomUUID(),
    title,
    content,
    filePath,
    workspacePath,
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

export function switchToTab(index: number) {
  const wsTabs = get(activeWorkspaceTabs);
  if (index >= 0 && index < wsTabs.length) {
    activeTabId.set(wsTabs[index].id);
  }
}

export function cycleTab(direction: 1 | -1) {
  const wsTabs = get(activeWorkspaceTabs);
  if (wsTabs.length < 2) return;
  const currentId = get(activeTabId);
  const currentIndex = wsTabs.findIndex((tab) => tab.id === currentId);
  const nextIndex = (currentIndex + direction + wsTabs.length) % wsTabs.length;
  activeTabId.set(wsTabs[nextIndex].id);
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
    const key = getTabWorkspacePath(tab);
    const list = groups.get(key) ?? [];
    list.push(tab);
    groups.set(key, list);
  }
  return groups;
}
