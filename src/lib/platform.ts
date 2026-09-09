/**
 * Platform-aware keyboard hint labels.
 *
 * Chord *handling* is already cross-platform — `shortcuts.ts` accepts
 * `metaKey || ctrlKey` everywhere — but the labels the UI renders were written
 * against the macOS design handoff and hardcoded the Command glyph. On Windows
 * and Linux a hint that reads "⌘N" names a key the keyboard does not have.
 *
 * Kept a plain `.ts` module with an injectable `nav` so it stays importable and
 * testable under the Node test env, which has no `navigator`.
 */

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
}

/** True on macOS. Defaults to false when there is no navigator (test env, SSR). */
export function isMacPlatform(nav?: NavigatorLike): boolean {
  const n =
    nav ?? (typeof navigator !== "undefined" ? (navigator as NavigatorLike) : undefined);
  if (!n) return false;
  return /mac/i.test(`${n.platform ?? ""} ${n.userAgent ?? ""}`);
}

const IS_MAC: boolean = isMacPlatform();

/**
 * The platform modifier's label. macOS renders the glyph tight against the key;
 * Windows and Linux spell the modifier out with a separator.
 */
export function modLabel(isMac: boolean = IS_MAC): string {
  return isMac ? "⌘" : "Ctrl+";
}

/** Shift's label, written the same two ways. */
export function shiftLabel(isMac: boolean = IS_MAC): string {
  return isMac ? "⇧" : "Shift+";
}

/**
 * A full chord label, e.g. `chord("N")` -> "⌘N" or "Ctrl+N".
 *
 * For a rebindable chord use `keymap.formatBinding()` instead; this stays for
 * the fixed keys that are not in the global keymap.
 */
export function chord(key: string, isMac: boolean = IS_MAC): string {
  return `${modLabel(isMac)}${key}`;
}

/** The Return key's label: a glyph on macOS, the word elsewhere. */
export function enterLabel(isMac: boolean = IS_MAC): string {
  return isMac ? "⏎" : "Enter";
}
