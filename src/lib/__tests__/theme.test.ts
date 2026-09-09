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
    // --accent is per-theme now: light had to darken to clear 4.5:1 as text.
    expect(lightXtermTheme.cursor).toBe("#217457");
    expect(darkXtermTheme.cursor).toBe("#2fa37a");
  });

  it("keeps the two palettes distinct", () => {
    expect(lightXtermTheme).not.toEqual(darkXtermTheme);
    expect(lightXtermTheme.background).not.toBe(darkXtermTheme.background);
    expect(lightXtermTheme.foreground).not.toBe(darkXtermTheme.foreground);
    /* Every slot differs now: `cursor` is --accent, which used to be the one
       colour the two themes shared and is per-theme since light darkened. */
    for (const key of KEYS) {
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

// ── The CSS token blocks ─────────────────────────────────────────────────────

// Vite inlines the stylesheet as a string, so the assertions below read the
// real token blocks rather than a copy that could drift from them.
import APP_CSS from "../../app.css?raw";

/** Where the header comment stops naming selectors and the real ones begin. */
const AFTER_HEADER = APP_CSS.indexOf("*/") + 2;

/** The `--token: value` pairs inside the block that `selector` opens. */
function tokenBlock(selector: string): Record<string, string> {
  const at = APP_CSS.indexOf(selector, AFTER_HEADER);
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const open = APP_CSS.indexOf("{", at);
  let depth = 0;
  let i = open;
  for (; i < APP_CSS.length; i++) {
    if (APP_CSS[i] === "{") depth++;
    else if (APP_CSS[i] === "}" && --depth === 0) break;
  }
  const out: Record<string, string> = {};
  for (const m of APP_CSS.slice(open + 1, i).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const LIGHT = tokenBlock(":root");
const DARK_EXPLICIT = tokenBlock('[data-theme="dark"]');
const DARK_MEDIA = tokenBlock(':root:not([data-theme="light"])');

/** Every ink token, against the surfaces it is actually rendered on. */
const ON: Record<string, string[]> = {
  "--text": ["--bg", "--surface", "--surface2", "--surface3"],
  "--muted": ["--bg", "--surface", "--surface2", "--surface3"],
  "--accent": ["--bg", "--surface", "--surface2", "--surface3"],
  "--danger": ["--bg", "--surface", "--surface2", "--surface3"],
  "--warn": ["--bg", "--surface", "--surface2", "--surface3"],
  "--term-text": ["--term-bg"],
  "--t-user": ["--term-bg"],
  "--t-step": ["--term-bg"],
  "--t-tool": ["--term-bg"],
  "--t-warn": ["--term-bg"],
  "--accent-ink": ["--accent"],
  "--ink-text": ["--ink"],
};

describe("app.css token blocks", () => {
  /* The failure the review reported: dark is declared twice — once for an
     explicit choice and once for the system preference — and round 1 raised a
     light token without touching one of them. A value in one block and not the
     other makes "Dark" and "System → dark" disagree. */
  it("define dark identically in both blocks", () => {
    expect(Object.keys(DARK_EXPLICIT).sort()).toEqual(Object.keys(DARK_MEDIA).sort());
    for (const key of Object.keys(DARK_EXPLICIT)) {
      expect(DARK_MEDIA[key], key).toBe(DARK_EXPLICIT[key]);
    }
  });

  it("declare dark as a full override of every colour light sets", () => {
    // A colour token added to light and not to dark renders a light ink on a
    // dark surface. The model colours are the deliberate exception — app.css
    // says so — because a model's identity should not change with the theme.
    const shared = /^--model-/;
    const colours = Object.keys(LIGHT).filter(
      (k) => /^#|^rgba?\(/.test(LIGHT[k]) && !shared.test(k),
    );
    for (const key of colours) {
      expect(DARK_EXPLICIT, key).toHaveProperty(key);
    }
  });

  for (const [name, tokens] of [
    ["light", LIGHT],
    ["dark", DARK_EXPLICIT],
  ] as const) {
    /* Measured, not asserted in a comment — this is what "make both themes
       consistent" reduces to once it is checkable. */
    it(`${name} clears 4.5:1 for every ink on every surface it renders on`, () => {
      for (const [ink, surfaces] of Object.entries(ON)) {
        for (const surface of surfaces) {
          const fg = tokens[ink];
          const bg = tokens[surface];
          expect(fg, `${name} ${ink}`).toMatch(/^#[0-9a-f]{6}$/);
          expect(bg, `${name} ${surface}`).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrast(fg, bg), `${name}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    });
  }

  it("leaves neither theme the weak one", () => {
    const floor = (tokens: Record<string, string>) =>
      Math.min(
        ...Object.entries(ON).flatMap(([ink, surfaces]) =>
          surfaces.map((s) => contrast(tokens[ink], tokens[s])),
        ),
      );
    const light = floor(LIGHT);
    const dark = floor(DARK_EXPLICIT);
    expect(light).toBeGreaterThanOrEqual(4.5);
    expect(dark).toBeGreaterThanOrEqual(4.5);
    // Comparable margins: neither theme's weakest pair is far below the other's.
    expect(Math.abs(light - dark)).toBeLessThan(1.5);
  });

  it("keeps --t-tool the muted role rather than a leftover", () => {
    // It had been left at the value --muted was raised off, which made the same
    // role two different colours depending on which pane it was in.
    expect(LIGHT["--t-tool"]).toBe(LIGHT["--muted"]);
    expect(DARK_EXPLICIT["--t-tool"]).toBe(DARK_EXPLICIT["--muted"]);
  });

  it("mirrors --term-bg / --term-text / --accent into theme.ts", () => {
    expect(lightXtermTheme.background).toBe(LIGHT["--term-bg"]);
    expect(lightXtermTheme.foreground).toBe(LIGHT["--term-text"]);
    expect(lightXtermTheme.cursor).toBe(LIGHT["--accent"]);
    expect(darkXtermTheme.background).toBe(DARK_EXPLICIT["--term-bg"]);
    expect(darkXtermTheme.foreground).toBe(DARK_EXPLICIT["--term-text"]);
    expect(darkXtermTheme.cursor).toBe(DARK_EXPLICIT["--accent"]);
  });
});
