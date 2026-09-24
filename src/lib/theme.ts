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
 * The dark palette's coloured slots are held to S≈35% at their existing
 * lightness — WCAG contrast is luminance-only, so saturation is free to pull
 * down. Dark `yellow` is exempt: it is `--warn`, and desaturating it at fixed
 * lightness would fall to 6.88:1, under the 7:1 floor above.
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
  /* --surface3, the same slot dark's `black` takes. Left at #17181b it was
     near-black ink on a light ground, and Claude Code fills the row behind
     your own messages with `ESC[40m` — so every prompt you typed came back as
     a black bar. `minimumContrastRatio` re-inks whatever the TUI writes on
     top, so the fill only has to read as a raised surface. */
  black: "#e5e5ea",
  red: "#83443f",
  green: "#285343",
  yellow: "#58482a",
  blue: "#365671",
  magenta: "#803d76",
  cyan: "#234a49",
  white: "#474a50", // --muted
  brightBlack: "#52565e",
  brightRed: "#6b3734",
  brightGreen: "#214436",
  brightYellow: "#473a22",
  brightBlue: "#2c465a",
  brightMagenta: "#683260",
  brightCyan: "#1d3b3a",
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
  red: "#ce9c98",
  green: "#59af8f",
  yellow: "#e0a53a",
  blue: "#8eb0c9",
  magenta: "#cb93bc",
  cyan: "#60b3ae",
  white: "#c9cbd1",
  brightBlack: "#acb2bc", // --muted
  brightRed: "#d8b2af",
  brightGreen: "#80c2a9",
  brightYellow: "#edc06a",
  brightBlue: "#aec7d8",
  brightMagenta: "#dab1cf",
  brightCyan: "#8ac7c3",
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

/* Row-block tints for the classified terminal transcript, mirroring
   --term-tint-user / --term-tint-tool from app.css. These are row
   backgrounds, not inks, so held to "close to --term-bg" rather than the
   7:1 ink floor above; xterm's decoration API takes only #RRGGBB, so no
   alpha. Kept out of `lightXtermTheme`/`darkXtermTheme` since those are
   ITheme objects whose keys are asserted against xterm's type. */
export const lightBlockTints = { user: "#f0f0f3", tool: "#eaeaee" } as const;
export const darkBlockTints = { user: "#1a1c1f", tool: "#1d1f23" } as const;

/** The row-tint palette matching `mode` right now. */
export function activeBlockTints(mode: ThemeMode) {
  return resolvedTheme(mode) === "dark" ? darkBlockTints : lightBlockTints;
}

/* Keep <html data-theme> in step with the store for the lifetime of the app. */
themeMode.subscribe(applyTheme);
