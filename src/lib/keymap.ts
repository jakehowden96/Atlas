/**
 * The global keymap: which chord fires which action.
 *
 * A pure model with no Svelte dependency, in the same shape as `new-session.ts`
 * and `overview.ts`, so the matching rules are testable on their own. The
 * writable holding the user's edited copy lives in `stores/settings.ts`; the
 * dispatcher that runs the actions lives in `shortcuts.ts`.
 */
import { isMacPlatform, modLabel, shiftLabel } from "./platform";

/** Every rebindable global chord. */
export type Action =
  | "newSession"
  | "jump"
  | "settings"
  | "saveFile"
  | "openFile"
  | "toggleRail"
  | "tab1"
  | "tab2"
  | "tab3"
  | "tab4"
  | "backToSessions"
  | "shortcuts";

export interface Binding {
  /** The platform modifier. ⌘ and Ctrl are accepted interchangeably, so one
   *  binding covers macOS and Windows/Linux without branching. */
  mod: boolean;
  /** Absent means the chord fires with or without Shift. `⌘\` is bound that way
   *  because `Ctrl+Shift+\` is how some layouts reach the backslash. */
  shift?: boolean;
  /** `Digit0`–`Digit9` are matched against `e.code`, because with the modifier
   *  held a non-US layout reports punctuation in `e.key`. Everything else is
   *  matched case-insensitively against `e.key`. */
  key: string;
}

/**
 * The chords that fire each action, primary first.
 *
 * More than one because a chord the OS eats cannot be fixed by better
 * dispatch: macOS reserves ⌘Escape (Force Quit, and Voice Control on current
 * versions), so `backToSessions` also ships ⌘. — the long-standing macOS
 * cancel chord, which does reach a web view. Windows and Linux keep ⌘/Ctrl+Esc
 * as the primary and are unchanged.
 */
export type Keymap = Record<Action, Binding[]>;

/** Dispatch order, and the order Settings lists the rows in. */
export const ACTIONS: Action[] = [
  "newSession",
  "jump",
  "settings",
  "saveFile",
  "openFile",
  "toggleRail",
  "tab1",
  "tab2",
  "tab3",
  "tab4",
  "backToSessions",
  "shortcuts",
];

/** Row labels for Settings › Keyboard. */
export const ACTION_LABELS: Record<Action, string> = {
  newSession: "New session",
  jump: "Jump to…",
  settings: "Settings",
  saveFile: "Save file",
  openFile: "Open…",
  toggleRail: "Toggle activity rail",
  tab1: "Sessions tab",
  tab2: "Files tab",
  tab3: "Pull requests tab",
  tab4: "Stats tab",
  backToSessions: "Back to Sessions",
  shortcuts: "Keyboard shortcuts",
};

export const DEFAULT_KEYMAP: Keymap = {
  newSession: [{ mod: true, shift: false, key: "n" }],
  jump: [{ mod: true, shift: false, key: "k" }],
  settings: [{ mod: true, shift: false, key: "," }],
  saveFile: [{ mod: true, shift: false, key: "s" }],
  openFile: [{ mod: true, shift: false, key: "o" }],
  toggleRail: [{ mod: true, key: "\\" }],
  tab1: [{ mod: true, shift: false, key: "Digit1" }],
  tab2: [{ mod: true, shift: false, key: "Digit2" }],
  tab3: [{ mod: true, shift: false, key: "Digit3" }],
  tab4: [{ mod: true, shift: false, key: "Digit4" }],
  /* Bare Escape belongs to the Claude Code TUI, so returning to Sessions from a
     focused terminal is a chord of its own — and on macOS it takes two, because
     the OS never delivers ⌘Escape to the web view. See `Keymap`. */
  backToSessions: [
    { mod: true, shift: false, key: "Escape" },
    { mod: true, shift: false, key: "." },
  ],
  /* The shortcut sheet. A bare `?` is the usual chord for it, but every binding
     here is dispatched off `svelte:window` with no is-typing guard, so a
     modifierless key would swallow the character everywhere text is entered —
     the same mistake the `phase 06 follow-up` reverted. Shift is left absent so
     the chord still fires on a layout that shifts to reach `/`. */
  shortcuts: [{ mod: true, key: "/" }],
};

const DIGIT_CODE = /^Digit[0-9]$/;

/** Keys that are only a modifier — never a binding on their own. */
const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph", "CapsLock"]);

/** The one place that decides whether a keypress is a given chord. */
export function matchBinding(e: KeyboardEvent, binding: Binding): boolean {
  // Alt disqualifies the chord, because AltGr on a non-US Windows or Linux
  // layout reports itself as Ctrl+Alt — so `AltGr+2` and `AltGr+ß` are how
  // those keyboards type `@` and `\`, not a request to switch tabs.
  if (e.altKey) return false;
  if (binding.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (binding.shift !== undefined && binding.shift !== e.shiftKey) return false;
  if (DIGIT_CODE.test(binding.key)) return e.code === binding.key;
  return typeof e.key === "string" && e.key.toLowerCase() === binding.key.toLowerCase();
}

/** True when the event is any of an action's chords. */
export function matchesAction(e: KeyboardEvent, bindings: Binding[]): boolean {
  return bindings.some((binding) => matchBinding(e, binding));
}

/** True when the event is any chord of any action. */
export function matchesAnyBinding(e: KeyboardEvent, keymap: Keymap): boolean {
  return ACTIONS.some((action) => matchesAction(e, keymap[action]));
}

function signature(b: Binding): string {
  return `${b.mod ? "mod+" : ""}${b.shift ? "shift+" : ""}${b.key.toLowerCase()}`;
}

/**
 * The actions that share a chord with another action.
 *
 * Every binding counts, alternates included — two actions colliding through
 * their second chord is exactly as broken as colliding through their first,
 * and only one of them would ever fire.
 */
export function findConflicts(keymap: Keymap): Action[] {
  const owners = new Map<string, Set<Action>>();
  for (const action of ACTIONS) {
    for (const binding of keymap[action]) {
      const sig = signature(binding);
      const set = owners.get(sig) ?? new Set<Action>();
      set.add(action);
      owners.set(sig, set);
    }
  }
  const clashing = new Set<Action>();
  for (const set of owners.values()) {
    if (set.size > 1) for (const action of set) clashing.add(action);
  }
  return ACTIONS.filter((action) => clashing.has(action));
}

const IS_MAC: boolean = isMacPlatform();

function keyLabel(key: string): string {
  if (DIGIT_CODE.test(key)) return key.slice(5);
  if (key === "Escape") return "Esc";
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The display label, e.g. "⌘N" on macOS and "Ctrl+N" elsewhere. */
export function formatBinding(binding: Binding, isMac: boolean = IS_MAC): string {
  const mod = binding.mod ? modLabel(isMac) : "";
  const shift = binding.shift ? shiftLabel(isMac) : "";
  return `${mod}${shift}${keyLabel(binding.key)}`;
}

/**
 * False for a chord the OS takes before the app can see it.
 *
 * macOS reserves ⌘Escape system-wide, so naming it in a hint tells the user to
 * press something that will never arrive. Dispatch still tries it — if a macOS
 * version ever does deliver it, it works — but no label promises it.
 */
export function isReachable(binding: Binding, isMac: boolean = IS_MAC): boolean {
  return !(isMac && binding.mod && binding.key === "Escape");
}

/**
 * What to show the user for an action: its chords, joined, with the ones this
 * OS swallows left out. If that would leave nothing, every chord is shown —
 * a wrong hint still beats a blank one.
 */
export function formatChord(bindings: Binding[], isMac: boolean = IS_MAC): string {
  const usable = bindings.filter((b) => isReachable(b, isMac));
  const shown = usable.length > 0 ? usable : bindings;
  return shown.map((b) => formatBinding(b, isMac)).join(" or ");
}

/**
 * Turn a keypress into a binding for the recorder in Settings. Null means the
 * press is not a usable chord: a bare modifier, an AltGr composition, or a key
 * without the platform modifier — an unmodified binding would swallow ordinary
 * typing everywhere in the app.
 */
export function parseBindingFromEvent(e: KeyboardEvent): Binding | null {
  if (MODIFIER_KEYS.has(e.key) || e.altKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  return {
    mod: true,
    shift: e.shiftKey,
    key: DIGIT_CODE.test(e.code) ? e.code : e.key,
  };
}

function isBinding(v: unknown): v is Binding {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (typeof b.key !== "string" || b.key.length === 0) return false;
  if (typeof b.mod !== "boolean") return false;
  return b.shift === undefined || typeof b.shift === "boolean";
}

/**
 * Lay a persisted keymap over the defaults. Unknown actions and malformed
 * entries are dropped rather than thrown on, so a settings file written by any
 * earlier Atlas — or by hand — still loads.
 */
export function mergeKeymap(partial: unknown): Keymap {
  const merged: Keymap = { ...DEFAULT_KEYMAP };
  if (!partial || typeof partial !== "object") return merged;
  const entries = partial as Partial<Record<Action, unknown>>;
  for (const action of ACTIONS) {
    const value = entries[action];
    // A settings file written before alternates existed holds one binding per
    // action rather than a list.
    const list = Array.isArray(value) ? value : [value];
    const bindings = list
      .filter(isBinding)
      .map((b) => ({ mod: b.mod, shift: b.shift, key: b.key }));
    if (bindings.length === 0) continue;
    /* A stored list that is only a subset of the default one is a file written
       before this action gained its alternates, not a rebinding — the user
       never chose to drop the others. Taking it literally is what left macOS
       with ⌘Escape as the only way back to Sessions, a chord the OS never
       delivers, so "cmd + esc does nothing" outlived the fix that added ⌘. as
       the second chord. Anything the defaults do not contain is a real
       rebinding and is honoured exactly as stored. */
    const defaults = DEFAULT_KEYMAP[action];
    const allFromDefaults = bindings.every((b) => defaults.some((d) => signature(d) === signature(b)));
    merged[action] = allFromDefaults && bindings.length < defaults.length ? defaults : bindings;
  }
  return merged;
}
