/**
 * Neon Monolith color palette — single source of truth for the app theme.
 *
 * Deep midnight tonal architecture with luminous accents.
 * CSS custom properties are defined in App.svelte using these same values.
 * Use the CSS vars in Svelte component <style> blocks, and this object
 * where JS/TS runtime access is needed (e.g. xterm theme, mermaid config).
 */
export const theme = {
  /* Surface hierarchy (tonal depth, no borders) */
  surface: "#0a0e14",
  surfaceContainerLowest: "#000000",
  surfaceContainerLow: "#0f141a",
  surfaceContainerHigh: "#1b2028",
  surfaceContainerHighest: "#20262f",
  surfaceBright: "#262c36",

  /* Foreground / on-surface */
  onSurface: "#f1f3fc",
  onSurfaceVariant: "#a8abb3",

  /* Outline (ghost borders only) */
  outlineVariant: "#44484f",

  /* Primary */
  primary: "#72b1ff",
  primaryContainer: "#55a3fc",
  onPrimary: "#002f58",
  primaryDim: "#4a8ad4",

  /* Secondary (green / additions) */
  secondary: "#97f999",
  secondaryContainer: "#006e23",

  /* Error (red / deletions) */
  error: "#ff716c",
  errorContainer: "#9f0519",

  /* Tertiary (coral — AI tags) */
  tertiary: "#ff7167",

  /* Named ANSI colors for xterm */
  red: "#ff716c",
  redBright: "#ff847f",
  green: "#97f999",
  greenBright: "#a8ffaa",
  yellow: "#e8be7b",
  yellowBright: "#f5d29b",
  blue: "#72b1ff",
  blueBright: "#94c5ff",
  magenta: "#c48eed",
  magentaBright: "#d8abff",
  cyan: "#63bcc6",
  cyanBright: "#82d4dd",
  black: "#0f141a",
  blackBright: "#525868",
  white: "#a8abb3",
  whiteBright: "#f1f3fc",
} as const;

/** xterm.js ITheme config derived from the shared palette */
export const xtermTheme = {
  background: theme.surface,
  foreground: theme.onSurfaceVariant,
  cursor: theme.primary,
  cursorAccent: theme.surface,
  selectionBackground: "#1d3a5c",
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

/** Mermaid themeVariables derived from the shared palette */
export const mermaidThemeVariables = {
  darkMode: true,
  primaryColor: theme.primary,
  primaryTextColor: theme.onSurfaceVariant,
  primaryBorderColor: theme.outlineVariant,
  lineColor: theme.outlineVariant,
  secondaryColor: theme.surfaceContainerHigh,
  tertiaryColor: theme.surfaceContainerHighest,
  background: theme.surface,
  mainBkg: theme.surfaceContainerHigh,
  nodeBorder: theme.outlineVariant,
  clusterBkg: theme.surfaceContainerLow,
  fontSize: "13px",
} as const;
