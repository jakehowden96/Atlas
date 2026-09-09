import { get } from "svelte/store";
import { ACTIONS, matchBinding, type Action } from "./keymap";
import { saveActiveFile } from "./stores/files";
import { keymap, settingsOpen } from "./stores/settings";
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
  type View,
} from "./stores/view";

/** What each action does once its chord matches. */
const RUN: Record<Action, () => void> = {
  newSession: () => openNewSession(),
  jump: () => jumpOpen.set(true),
  settings: () => settingsOpen.set(true),
  saveFile: () => void saveActiveFile(),
  openFile: () => openDialogOpen.set(true),
  toggleRail: () => railOpen.update((v) => !v),
  tab1: () => showView(TAB_VIEWS[0]),
  tab2: () => showView(TAB_VIEWS[1]),
  tab3: () => showView(TAB_VIEWS[2]),
  tab4: () => showView(TAB_VIEWS[3]),
  backToSessions: () => showView("sessions"),
};

/**
 * Actions that only fire on one screen. Save and Open… have nothing to act on
 * anywhere but Files, so the chord is left alone on every other view.
 */
const SCOPED: Partial<Record<Action, View>> = {
  saveFile: "files",
  openFile: "files",
};

/**
 * Mission Control's global chords. Returns true when the event was consumed.
 *
 * Escape is deliberately *not* consumed when nothing is open — the Claude Code
 * TUI owns it, and `TerminalSession.attachCustomKeyEventHandler` never lets it
 * reach this handler while the terminal has focus.
 */
export function handleGlobalKeydown(e: KeyboardEvent): boolean {
  // The keymap first, so mod+Escape reaches `backToSessions` rather than
  // falling through into the bare-Escape ladder below.
  const bindings = get(keymap);
  for (const action of ACTIONS) {
    if (!matchBinding(e, bindings[action])) continue;
    const scope = SCOPED[action];
    if (scope && get(activeView) !== scope) continue;
    e.preventDefault();
    RUN[action]();
    return true;
  }

  // Esc — topmost modal, then the Changes drawer, then back to Sessions. This
  // is ordered modal dismissal rather than a binding, so it is not rebindable.
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
      showView("sessions");
      return true;
    }
    return false;
  }

  return false;
}
