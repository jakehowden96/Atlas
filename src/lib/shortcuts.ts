import { get } from "svelte/store";
import { settingsOpen } from "./stores/settings";
import {
  activeView,
  diffOpen,
  jumpOpen,
  newSessionOpen,
  openNewSession,
  railOpen,
  showView,
} from "./stores/view";

/** The platform's primary modifier: ⌘ on macOS, Ctrl on Windows/Linux. */
function mod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * Mission Control's global chords. Returns true when the event was consumed.
 *
 * Escape is deliberately *not* consumed when nothing is open — the Claude Code
 * TUI owns it, and `TerminalSession.attachCustomKeyEventHandler` never lets it
 * reach this handler while the terminal has focus.
 */
export function handleGlobalKeydown(e: KeyboardEvent): boolean {
  // ⌘N / Ctrl+N — new session, unseeded (a plain Fresh start)
  if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    openNewSession();
    return true;
  }

  // ⌘K / Ctrl+K — jump to session
  if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    jumpOpen.set(true);
    return true;
  }

  // ⌘, / Ctrl+, — settings
  if (mod(e) && !e.shiftKey && e.key === ",") {
    e.preventDefault();
    settingsOpen.set(true);
    return true;
  }

  // ⌘\ / Ctrl+Shift+\ — toggle the activity rail
  if (mod(e) && e.key === "\\") {
    e.preventDefault();
    railOpen.update((v) => !v);
    return true;
  }

  // Esc — topmost modal, then the Changes drawer, then back to Overview
  if (e.key === "Escape") {
    if (get(jumpOpen)) {
      e.preventDefault();
      jumpOpen.set(false);
      return true;
    }
    if (get(newSessionOpen)) {
      e.preventDefault();
      newSessionOpen.set(false);
      return true;
    }
    if (get(settingsOpen)) {
      e.preventDefault();
      settingsOpen.set(false);
      return true;
    }
    if (get(diffOpen)) {
      e.preventDefault();
      diffOpen.set(false);
      return true;
    }
    if (get(activeView) === "session") {
      e.preventDefault();
      showView("overview");
      return true;
    }
    return false;
  }

  return false;
}
