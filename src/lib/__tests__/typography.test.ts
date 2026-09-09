import { describe, expect, it } from "vitest";

/**
 * Every stylesheet in the app: `app.css` plus the `<style>` block of every
 * component. Vite hands these over as raw strings, so the assertions below
 * read the real declarations rather than a list that could drift from them.
 */
const SHEETS: Record<string, string> = {
  ...import.meta.glob("../../app.css", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../**/*.svelte", { query: "?raw", import: "default", eager: true }),
};

/** The smallest text the app is allowed to render. */
const FLOOR_PX = 12;

interface Decl {
  file: string;
  px: number;
  line: number;
}

/* Both spellings. The `font:` shorthand sets a size too, and nine of them
   were hiding under the first version of this guard — including the Sessions
   tile's transcript preview at 11.5px, which is one of the two labels the
   review named. */
const SIZE_PATTERNS = [/font-size:\s*([0-9.]+)px/, /\bfont:\s*(?:[\w-]+\s+)*?([0-9.]+)px/];

function fontSizesInPx(): Decl[] {
  const out: Decl[] = [];
  for (const [file, source] of Object.entries(SHEETS)) {
    const lines = source.split("\n");
    lines.forEach((text, i) => {
      for (const pattern of SIZE_PATTERNS) {
        const m = pattern.exec(text);
        if (m) out.push({ file, px: Number.parseFloat(m[1]), line: i + 1 });
      }
    });
  }
  return out;
}

describe("type scale", () => {
  /* The review said the text is thin and does not stand out, twice, and named
     two specific labels. Ninety-seven of the app's font-size declarations were
     under 12px — 10px and 10.5px among them — which is the whole complaint
     before any colour is involved. */
  it("renders nothing smaller than the floor", () => {
    const tooSmall = fontSizesInPx().filter((d) => d.px < FLOOR_PX);
    expect(
      tooSmall.map((d) => `${d.file}:${d.line} ${d.px}px`),
      "text below the floor",
    ).toEqual([]);
  });

  /* The floor alone would let the sixteen ad-hoc sizes creep back one
     component at a time. `app.css` is where the scale is declared, so it is
     the only file allowed to write a pixel size at all. */
  it("declares pixel sizes only where the scale itself is defined", () => {
    const offenders = fontSizesInPx().filter((d) => !d.file.endsWith("app.css"));
    expect(
      offenders.map((d) => `${d.file}:${d.line} ${d.px}px`),
      "components must use var(--fs-*)",
    ).toEqual([]);
  });

  /* Geist is a variable face and 400 on these backgrounds is exactly the
     "thin" the review reported, so body copy runs at 450. */
  it("never sets body copy back to 400", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SHEETS)) {
      source.split("\n").forEach((text, i) => {
        if (/font-weight:\s*400\b/.test(text)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("has some stylesheets to read", () => {
    expect(Object.keys(SHEETS).length).toBeGreaterThan(20);
  });
});
