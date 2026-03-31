import { switchToTab } from "./stores/terminal";
import { togglePanel, setSection } from "./stores/panel";

// Set by TerminalTab when it knows its CWD — used for manual refresh
export let requestPanelRefresh: (() => void) | null = null;
export function setRefreshHandler(handler: () => void) {
  requestPanelRefresh = handler;
}

export function handleGlobalKeydown(e: KeyboardEvent): boolean {
  // Ctrl+1-9: switch tabs
  if (e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    switchToTab(parseInt(e.key) - 1);
    return true;
  }

  // Ctrl+Shift+\: toggle panel
  if (e.ctrlKey && e.shiftKey && e.key === "\\") {
    e.preventDefault();
    togglePanel();
    return true;
  }

  // Ctrl+Shift+D: show diff
  if (e.ctrlKey && e.shiftKey && e.key === "D") {
    e.preventDefault();
    setSection("diff");
    return true;
  }

  // Ctrl+Shift+S: show summary
  if (e.ctrlKey && e.shiftKey && e.key === "S") {
    e.preventDefault();
    setSection("summary");
    return true;
  }

  // Ctrl+Shift+F: show flow
  if (e.ctrlKey && e.shiftKey && e.key === "F") {
    e.preventDefault();
    setSection("flow");
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
