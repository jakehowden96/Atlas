/**
 * Runtime mirror of the Mission Control CSS custom properties defined in
 * `src/app.css`. xterm.js takes a static theme object at init and cannot read
 * CSS vars, so this file is the source of truth for any code path that needs
 * the palette as plain hex strings.
 *
 * Contrast: every ANSI colour below clears 7:1 against its own `--term-bg`
 * — AAA, not AA. This palette is the ink Claude Code's TUI is read in for
 * hours at a time, so it is the app's body text more than any token in the
 * chrome is, and "the text is thin and doesn't stand out against the
 * background" was reported against Claude itself in both themes. Enforced by
 * `__tests__/theme.test.ts` rather than by this comment. The single exception
 * is `black`, which is the ANSI *background* tone rather than an ink — it is
 * deliberately close to `--term-bg` so `ESC[40m` fills read as the terminal
 * surface.
 *
 * Light needs the whole set darkened to get there, which on its own would
 * have collapsed `bright*` onto `*` — several pairs landed within one step of
 * each other at 7:1, and a TUI uses the bright half for emphasis. So the
 * coloured normals sit at 7:1 and the coloured brights at 9:1: on a light
 * ground, more ink is what emphasis looks like. `brightBlack` is the dim role
 * and stays the lightest ink in the palette at 7:1 exactly, so de-emphasised
 * text still reads as de-emphasised.
 *
 * The named slots are only half the story: `terminal-session.ts` sets xterm's
 * `minimumContrastRatio` for the dim/faint and 256-colour paths an ITheme
 * cannot reach.
 *
 * Keep this aligned with the token blocks in `src/app.css`.
 */
import { writable } from "svelte/store";

/** xterm ITheme for `--term-bg: #fafafb` / `--term-text: #2b2e35`. */
export const lightXtermTheme = {
  background: "#fafafb", // --term-bg
  foreground: "#2b2e35", // --term-text
  cursor: "#217457", // --accent
  cursorAccent: "#fafafb",
  selectionBackground: "#cfe8dd",
  selectionForeground: "#17181b",
  black: "#17181b",
  red: "#9d2f27",
  green: "#1a6146",
  yellow: "#725010",
  blue: "#165991",
  magenta: "#88367c",
  cyan: "#0d605e",
  white: "#474a50", // --muted
  brightBlack: "#52565e",
  brightRed: "#82251e",
  brightGreen: "#145039",
  brightYellow: "#5d410c",
  brightBlue: "#114975",
  brightMagenta: "#6f2c65",
  brightCyan: "#094f4c",
  brightWhite: "#2b2e35",
} as const;

/** xterm ITheme for `--term-bg: #111214` / `--term-text: #c9cbd1`. */
export const darkXtermTheme = {
  background: "#111214", // --term-bg
  foreground: "#c9cbd1", // --term-text
  cursor: "#2fa37a", // --accent
  cursorAccent: "#111214",
  selectionBackground: "#2c3b36",
  selectionForeground: "#e6e7ea",
  black: "#25272c",
  red: "#f8776e",
  green: "#46c294",
  yellow: "#e0a53a",
  blue: "#6bb6ec",
  magenta: "#d48ac0",
  cyan: "#4fc4bd",
  white: "#c9cbd1",
  brightBlack: "#acb2bc", // --muted
  brightRed: "#f79890",
  brightGreen: "#6fd3ad",
  brightYellow: "#edc06a",
  brightBlue: "#93cdf3",
  brightMagenta: "#e3a8d3",
  brightCyan: "#7ad7d1",
  brightWhite: "#e6e7ea",
} as const;

export type ThemeMode = "system" | "light" | "dark";

/** User's appearance choice. Persisted via `stores/settings.ts`. */
export const themeMode = writable<ThemeMode>("system");

/** Collapse `system` to the OS preference. Defaults to light off-DOM. */
export function resolvedTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof matchMedia !== "function") return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Stamp the choice on `<html>`. `system` removes the attribute so the
 * `prefers-color-scheme` block in `app.css` takes over. No-ops under the Node
 * test env, where there is no document.
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = mode;
  }
}

/** The xterm ITheme matching `mode` right now. */
export function activeXtermTheme(mode: ThemeMode) {
  return resolvedTheme(mode) === "dark" ? darkXtermTheme : lightXtermTheme;
}

/* Keep <html data-theme> in step with the store for the lifetime of the app. */
themeMode.subscribe(applyTheme);
