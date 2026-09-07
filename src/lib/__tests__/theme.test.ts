import { describe, it, expect, afterEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  lightXtermTheme,
  darkXtermTheme,
  resolvedTheme,
  activeXtermTheme,
  applyTheme,
  themeMode,
} from "../theme";

/** WCAG 2.1 relative luminance for a #rrggbb string. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every ITheme key both palettes must carry. */
const KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/* Inks drawn straight onto --term-bg. Excluded: the three background-role
   colours; `black`, which is the ANSI *background* tone and so sits close to
   --term-bg by design; `cursor`, a non-text element held to 3:1; and
   `selectionForeground`, which is judged against `selectionBackground`. */
const BG_ROLE = ["background", "cursorAccent", "selectionBackground"];
const INK_KEYS = KEYS.filter(
  (k) => !BG_ROLE.includes(k) && !["black", "cursor", "selectionForeground"].includes(k),
);

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  themeMode.set("system");
});

describe("xterm palettes", () => {
  for (const [name, palette] of [
    ["lightXtermTheme", lightXtermTheme],
    ["darkXtermTheme", darkXtermTheme],
  ] as const) {
    it(`${name} defines every ITheme colour as a hex string`, () => {
      for (const key of KEYS) {
        expect(palette[key], key).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it(`${name} inks clear 4.5:1 against its own background`, () => {
      for (const key of INK_KEYS) {
        expect(contrast(palette[key], palette.background), key).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(palette.selectionForeground, palette.selectionBackground),
      ).toBeGreaterThanOrEqual(4.5);
      /* Cursor is a non-text element: WCAG 1.4.11 asks for 3:1. */
      expect(contrast(palette.cursor, palette.background)).toBeGreaterThanOrEqual(3);
    });
  }

  it("mirrors the --term-bg / --term-text / --accent tokens", () => {
    expect(lightXtermTheme.background).toBe("#fafafb");
    expect(lightXtermTheme.foreground).toBe("#2b2e35");
    expect(darkXtermTheme.background).toBe("#111214");
    expect(darkXtermTheme.foreground).toBe("#c9cbd1");
    expect(lightXtermTheme.cursor).toBe("#2fa37a");
    expect(darkXtermTheme.cursor).toBe("#2fa37a");
  });

  it("keeps the two palettes distinct", () => {
    expect(lightXtermTheme).not.toEqual(darkXtermTheme);
    expect(lightXtermTheme.background).not.toBe(darkXtermTheme.background);
    expect(lightXtermTheme.foreground).not.toBe(darkXtermTheme.foreground);
    /* `cursor` is --accent, the one colour shared by both themes. */
    for (const key of KEYS.filter((k) => k !== "cursor")) {
      expect(lightXtermTheme[key], key).not.toBe(darkXtermTheme[key]);
    }
  });
});

describe("resolvedTheme", () => {
  it("passes explicit modes straight through", () => {
    stubMatchMedia(true);
    expect(resolvedTheme("light")).toBe("light");
    expect(resolvedTheme("dark")).toBe("dark");
  });

  it("maps system to dark when the OS prefers dark", () => {
    stubMatchMedia(true);
    expect(resolvedTheme("system")).toBe("dark");
  });

  it("maps system to light when the OS prefers light", () => {
    stubMatchMedia(false);
    expect(resolvedTheme("system")).toBe("light");
  });

  it("falls back to light when matchMedia is unavailable", () => {
    expect(resolvedTheme("system")).toBe("light");
  });
});

describe("activeXtermTheme", () => {
  it("follows the resolved theme", () => {
    stubMatchMedia(true);
    expect(activeXtermTheme("system")).toBe(darkXtermTheme);
    expect(activeXtermTheme("light")).toBe(lightXtermTheme);
    stubMatchMedia(false);
    expect(activeXtermTheme("system")).toBe(lightXtermTheme);
    expect(activeXtermTheme("dark")).toBe(darkXtermTheme);
  });
});

describe("themeMode / applyTheme", () => {
  it("defaults to system", () => {
    expect(get(themeMode)).toBe("system");
  });

  it("is a no-op without a document", () => {
    expect(typeof document).toBe("undefined");
    expect(() => applyTheme("dark")).not.toThrow();
  });

  it("stamps data-theme for explicit modes and clears it for system", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    vi.stubGlobal("document", { documentElement: root });

    applyTheme("dark");
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(root.dataset.theme).toBe("light");
    applyTheme("system");
    expect(root.dataset.theme).toBeUndefined();
  });
});
