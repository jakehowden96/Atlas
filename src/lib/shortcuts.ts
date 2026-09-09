import { get } from "svelte/store";
import { saveActiveFile } from "./stores/files";
import { settingsOpen } from "./stores/settings";
import {
  activeView,
  diffOpen,
  jumpOpen,
  newSessionOpen,
  openDialogOpen,
  openNewSession,
  railOpen,
  showView,
  TAB_VIEWS,
} from "./stores/view";

/**
 * The platform's primary modifier: ⌘ on macOS, Ctrl on Windows/Linux.
 *
 * Alt disqualifies the chord, because AltGr on a non-US Windows or Linux
 * layout reports itself as Ctrl+Alt — so `AltGr+2` and `AltGr+ß` are how those
 * keyboards type `@` and `\`, not a request to switch tabs.
 */
function mod(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey;
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

  // ⌘S / Ctrl+S — save the file the Files editor is showing. Scoped to that
  // view so the chord is left alone on every other screen.
  if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "s" && get(activeView) === "files") {
    e.preventDefault();
    void saveActiveFile();
    return true;
  }

  // ⌘O / Ctrl+O — the Open… dialog. Scoped to the Files view for the same
  // reason ⌘S is: nothing on the other screens has a file to open.
  if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "o" && get(activeView) === "files") {
    e.preventDefault();
    openDialogOpen.set(true);
    return true;
  }

  // ⌘\ / Ctrl+Shift+\ — toggle the activity rail
  if (mod(e) && e.key === "\\") {
    e.preventDefault();
    railOpen.update((v) => !v);
    return true;
  }

  // ⌘1–4 / Ctrl+1–4 — jump straight to a top-bar tab
  if (mod(e) && !e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
    e.preventDefault();
    showView(TAB_VIEWS[Number(e.code.slice(5)) - 1]);
    return true;
  }

  // Esc — topmost modal, then the Changes drawer, then back to Overview
  if (e.key === "Escape") {
    if (get(jumpOpen)) {
      e.preventDefault();
      jumpOpen.set(false);
      return true;
    }
    if (get(openDialogOpen)) {
      e.preventDefault();
      openDialogOpen.set(false);
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
