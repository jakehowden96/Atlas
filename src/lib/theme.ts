/**
 * Tokyo Night color palette — single source of truth for the app theme.
 *
 * CSS custom properties are defined in app.css using these same values.
 * Use the CSS vars in Svelte component <style> blocks, and this object
 * where JS/TS runtime access is needed (e.g. xterm theme, mermaid config).
 */
export const theme = {
  bg: "#1a1b26",
  bgDark: "#13141c",
  bgLight: "#1e2030",
  fg: "#a9b1d6",
  fgBright: "#c0caf5",
  fgMuted: "#787c99",
  fgDim: "#444b6a",
  fgSubtle: "#565f89",
  border: "#292d3e",
  borderLight: "#3b4261",
  red: "#f7768e",
  redBright: "#ff7a93",
  green: "#9ece6a",
  greenBright: "#b9f27c",
  yellow: "#e0af68",
  yellowBright: "#ff9e64",
  blue: "#7aa2f7",
  blueBright: "#7da6ff",
  magenta: "#ad8ee6",
  magentaBright: "#bb9af7",
  cyan: "#449dab",
  cyanBright: "#0db9d7",
  black: "#32344a",
  white: "#787c99",
  whiteBright: "#acb0d0",
} as const;

/** xterm.js ITheme config derived from the shared palette */
export const xtermTheme = {
  background: theme.bg,
  foreground: theme.fg,
  cursor: theme.fgBright,
  selectionBackground: "#33467c",
  black: theme.black,
  red: theme.red,
  green: theme.green,
  yellow: theme.yellow,
  blue: theme.blue,
  magenta: theme.magenta,
  cyan: theme.cyan,
  white: theme.white,
  brightBlack: theme.fgDim,
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
  primaryColor: theme.blue,
  primaryTextColor: theme.fg,
  primaryBorderColor: theme.borderLight,
  lineColor: theme.fgDim,
  secondaryColor: theme.bgLight,
  tertiaryColor: theme.border,
  background: theme.bg,
  mainBkg: theme.bgLight,
  nodeBorder: theme.borderLight,
  clusterBkg: theme.bgDark,
  fontSize: "13px",
} as const;
