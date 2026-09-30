import { get, writable } from "svelte/store";
import type { NeedsInputKind, TabItem } from "../../types/terminal";
import { panelData } from "./panel";
import { activeWorkspacePath } from "./workspace";

export const tabs = writable<TabItem[]>([]);
export const activeTabId = writable<string>("");

export function addTab(tab: TabItem, opts?: { activate?: boolean }) {
  tabs.update((t) => [...t, tab]);
  if (opts?.activate !== false) activeTabId.set(tab.id);
}

export function removeTab(id: string) {
  setPermissionPromptVisible(id, false);

  const wasActive = get(activeTabId) === id;
  const removedTab = get(tabs).find((t) => t.id === id);
  const removedWs = removedTab?.cwd ?? "";

  tabs.update((t) => t.filter((tab) => tab.id !== id));

  if (wasActive) {
    const remaining = get(tabs);
    // Prefer falling back to another tab in the same workspace
    const sameWsTab = [...remaining].reverse().find((t) => (t.cwd ?? "") === removedWs);
    const fallback = remaining[remaining.length - 1];
    if (sameWsTab) {
      activeTabId.set(sameWsTab.id);
    } else if (fallback) {
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
 * Resolve once the tab has a live PTY, or `null` if it is closed first, its
 * spawn failed, or the wait runs out.
 *
 * The pty id arrives from the other side of the component tree —
 * `TerminalSession` spawns the PTY and `TerminalContainer` writes the id back
 * onto the tab — so the store update is the signal. Waiting on it directly
 * beats polling for it: the caller resumes on the same tick the id lands, and
 * a tab that never spawns is bounded by the timeout rather than an attempt
 * count that has to be kept in step with the interval.
 */
export function awaitTabPty(id: string, timeoutMs = 10_000): Promise<TabItem | null> {
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
      if (tab.spawnError) return settle(null);
      if (tab.ptyId >= 0) settle(tab);
    });
    if (settled) unsubscribe();
  });
}

export function setTabSpawnError(id: string, spawnError: string) {
  tabs.update((t) => t.map((tab) => (tab.id === id ? { ...tab, spawnError } : tab)));
}

/**
 * The tab's shell exited on its own. The tab stays, showing what was left on
 * screen, but it no longer has a PTY to write to, and nothing it was waiting
 * on (the "Starting…" overlay, a permission prompt) is coming any more.
 */
export function markTabExited(id: string) {
  setPermissionPromptVisible(id, false);
  tabs.update((t) =>
    t.map((tab) =>
      tab.id === id
        ? { ...tab, exited: true, ready: true, needsInput: false, needsInputKind: undefined }
        : tab,
    ),
  );
}

/** Whether there is a running shell to write to: the PTY exists and has not exited. */
export function hasLivePty(tab: TabItem | undefined): tab is TabItem {
  return tab !== undefined && tab.ptyId >= 0 && !tab.exited;
}

export function setTabReady(id: string) {
  tabs.update((t) => t.map((tab) => (tab.id === id ? { ...tab, ready: true } : tab)));
}

export function setTabNeedsInput(id: string, needsInput: boolean, kind?: NeedsInputKind) {
  const t = get(tabs);
  const tab = t.find((x) => x.id === id);
  const nextKind = needsInput ? kind : undefined;
  if (!tab || (tab.needsInput === needsInput && tab.needsInputKind === nextKind)) return;
  tabs.update((arr) =>
    arr.map((x) => (x.id === id ? { ...x, needsInput, needsInputKind: nextKind } : x)),
  );
}

/** Tabs whose terminal screen currently shows a Claude Code permission prompt,
 *  as `TerminalSession` publishes it. Kept out of `tabs` so that a TUI
 *  repaint does not invalidate every derivation that reads the tab list. */
export const permissionPromptTabs = writable<ReadonlySet<string>>(new Set());

export function setPermissionPromptVisible(id: string, visible: boolean) {
  const current = get(permissionPromptTabs);
  if (current.has(id) === visible) return;
  const next = new Set(current);
  if (visible) next.add(id);
  else next.delete(id);
  permissionPromptTabs.set(next);
}

/**
 * Whether a tile may type an answer into this tab's PTY: the Notification
 * hook flagged a permission prompt, and that prompt is really on the screen.
 * Either signal alone goes stale — the hook flag lingers after the user
 * answers in the terminal, and an elicitation dialog is not a tool prompt.
 */
export function canAnswerPermission(
  tab: TabItem | undefined,
  promptTabs: ReadonlySet<string>,
): tab is TabItem {
  return (
    hasLivePty(tab) &&
    tab.needsInput === true &&
    tab.needsInputKind === "permission_prompt" &&
    promptTabs.has(tab.id)
  );
}
