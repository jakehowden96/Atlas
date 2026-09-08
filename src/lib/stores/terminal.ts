import { get, writable } from "svelte/store";
import type { TabItem } from "../../types/terminal";
import { panelData } from "./panel";
import { activeWorkspacePath } from "./workspace";

export const tabs = writable<TabItem[]>([]);
export const activeTabId = writable<string>("");

export function addTab(tab: TabItem, opts?: { activate?: boolean }) {
  tabs.update((t) => [...t, tab]);
  if (opts?.activate !== false) activeTabId.set(tab.id);
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
  const removedWs = removedTab?.cwd ?? "";

  tabs.update((t) => t.filter((tab) => tab.id !== id));

  if (wasActive) {
    const remaining = get(tabs);
    // Prefer falling back to another tab in the same workspace
    const sameWsTabs = remaining.filter((t) => (t.cwd ?? "") === removedWs);
    if (sameWsTabs.length > 0) {
      activeTabId.set(sameWsTabs[sameWsTabs.length - 1].id);
    } else if (remaining.length > 0) {
      const fallback = remaining[remaining.length - 1];
      activeTabId.set(fallback.id);
      // Sync workspace to match the cross-workspace fallback tab
      const fallbackWs = fallback.cwd ?? "";
      if (fallbackWs) {
        activeWorkspacePath.set(fallbackWs);
      }
    } else {
      activeTabId.set("");
    }
    panelData.set(null);
  }
}

/**
 * Resolve once the tab has a live PTY, or `null` if it is closed first or the
 * wait runs out.
 *
 * The pty id arrives from the other side of the component tree —
 * `TerminalSession` spawns the PTY and `TerminalContainer` writes the id back
 * onto the tab — so the store update is the signal. Waiting on it directly
 * beats polling for it: the caller resumes on the same tick the id lands, and
 * a tab that never spawns is bounded by the timeout rather than an attempt
 * count that has to be kept in step with the interval.
 */
export function awaitTabPty(
  id: string,
  timeoutMs = 10_000,
): Promise<TabItem | null> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const timer = setTimeout(() => settle(null), timeoutMs);

    function settle(tab: TabItem | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // `subscribe` runs its callback before it returns, so on an already-ready
      // tab there is nothing to unsubscribe from yet — the caller below does it.
      unsubscribe?.();
      resolve(tab);
    }

    unsubscribe = tabs.subscribe((list) => {
      const tab = list.find((t) => t.id === id);
      if (!tab) return settle(null);
      if (tab.ptyId >= 0) settle(tab);
    });
    if (settled) unsubscribe();
  });
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
