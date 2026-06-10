import { switchToTab, cycleTab } from "./stores/terminal";
import { togglePanel } from "./stores/panel";
import { cycleWorkspace } from "./stores/workspace";
import { openFile } from "./file-open";
import { saveActiveFile } from "./file-save";

// Set by TerminalTab when it knows its CWD — used for manual refresh
export let requestPanelRefresh: (() => void) | null = null;
export function setRefreshHandler(handler: () => void) {
  requestPanelRefresh = handler;
}

export function handleGlobalKeydown(e: KeyboardEvent): boolean {
  // Ctrl+O: open file
  if (e.ctrlKey && !e.shiftKey && e.key === "o") {
    e.preventDefault();
    openFile();
    return true;
  }

  // Ctrl+S: save active file
  if (e.ctrlKey && !e.shiftKey && e.key === "s") {
    e.preventDefault();
    saveActiveFile();
    return true;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab: cycle tabs
  if (e.ctrlKey && e.key === "Tab") {
    e.preventDefault();
    cycleTab(e.shiftKey ? -1 : 1);
    return true;
  }

  // Ctrl+1-9: switch tabs
  if (e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    switchToTab(parseInt(e.key, 10) - 1);
    return true;
  }

  // Ctrl+Shift+\: toggle panel
  if (e.ctrlKey && e.shiftKey && e.key === "\\") {
    e.preventDefault();
    togglePanel();
    return true;
  }

  // Ctrl+Shift+[: previous workspace
  if (e.ctrlKey && e.shiftKey && e.key === "[") {
    e.preventDefault();
    cycleWorkspace(-1);
    return true;
  }

  // Ctrl+Shift+]: next workspace
  if (e.ctrlKey && e.shiftKey && e.key === "]") {
    e.preventDefault();
    cycleWorkspace(1);
    return true;
  }

  // Ctrl+Shift+R: manual refresh panel
  if (e.ctrlKey && e.shiftKey && e.key === "R") {
    e.preventDefault();
    requestPanelRefresh?.();
    return true;
  }

  return false;
}
