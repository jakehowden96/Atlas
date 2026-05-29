/**
 * Everforest Hard Dark palette — runtime mirror of the CSS vars defined in
 * App.svelte. xterm.js takes a static theme object at init, so it cannot
 * read CSS vars — this file is the single source of truth for any code path
 * that needs the colors as plain hex strings (terminal, canvas, etc.).
 *
 * WCAG contrast on bg0 #272e33:
 *   fg #d3c6aa  → 7.97:1  AAA  default text
 *   grey2       → 5.36:1  AA   muted text
 *   accents     → ≥4.5:1  AA   (all named ANSI colors)
 *
 * Keep this aligned with the `:global(:root)` block in App.svelte; the
 * theme.test.ts assertions guard the surface/fg shape.
 */
export const theme = {
  /* Surface hierarchy (Everforest Hard Dark bg scale) */
  surface: "#272e33",                /* bg0 */
  surfaceContainerLowest: "#1e2326", /* bg_dim */
  surfaceContainerLow: "#2e383c",    /* bg1 */
  surfaceContainer: "#374145",       /* bg2 */
  surfaceContainerHigh: "#414b50",   /* bg3 */
  surfaceContainerHighest: "#495156",/* bg4 */
  surfaceBright: "#4f5b58",          /* bg5 */

  /* Foreground / on-surface */
  onSurface: "#d3c6aa",              /* fg — AAA on bg0 */
  onSurfaceVariant: "#9da9a0",       /* grey2 — AA on bg0 */

  /* Outline (≥3:1 against surface for non-text contrast) */
  outlineVariant: "#7a8478",         /* grey0 */

  /* Primary (blue) */
  primary: "#7fbbb3",
  primaryContainer: "#6ba89f",
  onPrimary: "#272e33",
  primaryDim: "#5a948c",

  /* Secondary (green — additions) */
  secondary: "#a7c080",
  secondaryContainer: "#425047",     /* bg_green */

  /* Error (red — deletions) */
  error: "#e67e80",
  errorContainer: "#514045",         /* bg_red */

  /* Tertiary (orange) */
  tertiary: "#e69875",

  /* Named ANSI colors for xterm — Everforest accent set */
  red: "#e67e80",
  redBright: "#ee8c8e",
  green: "#a7c080",
  greenBright: "#b6cd92",
  yellow: "#dbbc7f",
  yellowBright: "#e4c98a",
  blue: "#7fbbb3",
  blueBright: "#92c8c0",
  magenta: "#d699b6",
  magentaBright: "#e0a8c1",
  cyan: "#83c092",
  cyanBright: "#92cda0",
  /* Greyscale: black = bg, bright black = grey for dim text */
  black: "#272e33",
  blackBright: "#859289",            /* grey1 */
  white: "#9da9a0",                  /* grey2 */
  whiteBright: "#d3c6aa",            /* fg */
} as const;

/** xterm.js ITheme config derived from the shared palette. */
export const xtermTheme = {
  background: theme.surface,
  /* Use full fg (not grey2) so terminal output sits at AAA contrast */
  foreground: theme.onSurface,
  cursor: theme.primary,
  cursorAccent: theme.surface,
  /* Everforest "bg_visual" — a desaturated muted blue selection */
  selectionBackground: "#3c4841",
  selectionForeground: theme.onSurface,
  black: theme.black,
  red: theme.red,
  green: theme.green,
  yellow: theme.yellow,
  blue: theme.blue,
  magenta: theme.magenta,
  cyan: theme.cyan,
  white: theme.white,
  brightBlack: theme.blackBright,
  brightRed: theme.redBright,
  brightGreen: theme.greenBright,
  brightYellow: theme.yellowBright,
  brightBlue: theme.blueBright,
  brightMagenta: theme.magentaBright,
  brightCyan: theme.cyanBright,
  brightWhite: theme.whiteBright,
} as const;
