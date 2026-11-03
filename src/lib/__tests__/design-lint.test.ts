import { describe, expect, it } from "vitest";

/**
 * Guard for the design system. Every rule scans the raw source of every
 * component (and the gallery) so the old patterns cannot creep back in.
 * Each allow-list entry below says why it is an exception.
 */
const FILES: Record<string, string> = import.meta.glob("../../**/*.svelte", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ALLOW = {
  /* CodeMirror and xterm themes take literal colours in JS, and the diff
     viewer's code palette lives in app.css, so no component needs a literal. */
  color: [] as string[],
  /* Elements whose click is not the keyboard path: each is operable by key
     through a parent or sibling handler, so a role + onkeydown pair on the
     same tag would be wrong or duplicated. */
  click: [
    "files/FileEditor.svelte", // rendered markdown; clicks are delegated to links inside, which are focusable
    "sessions/SessionTile.svelte", // roving-tabindex card, keys handled on the same tag via onkeydown
    "ui/Menu.svelte", // role is computed per item; arrow/enter keys handled by the menu container
    "ui/Modal.svelte", // backdrop click to close; Escape handled by the dialog
    "ui/Select.svelte", // role=option; the combobox trigger owns the keys
    "ui/TreeRow.svelte", // twisty is a mouse shortcut; the row handles arrow keys
  ],
  /* Gallery pages are documentation of the system itself, not product UI. */
  gallery: ["/gallery/"],
  /* Icon is the only place the font class may appear. */
  icon: ["components/ui/Icon.svelte"],
  /* Fixtures only exist to mount components under test. */
  fixture: ["__tests__/"],
};

type Hit = string;

function allowed(file: string, list: string[]): boolean {
  return list.some((p) => file.includes(p));
}

function split(source: string): { markup: string; style: string } {
  const style = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join("\n");
  const markup = source
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return { markup, style };
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function scan(
  pick: "markup" | "style" | "both",
  pattern: RegExp,
  skip: string[] = [],
  test?: (m: RegExpExecArray) => boolean,
): Hit[] {
  const out: Hit[] = [];
  for (const [file, source] of Object.entries(FILES)) {
    if (allowed(file, [...skip, ...ALLOW.fixture])) continue;
    const { markup, style } = split(source);
    const parts = pick === "markup" ? [markup] : pick === "style" ? [style] : [markup, style];
    for (const text of parts) {
      for (const m of text.matchAll(
        new RegExp(pattern.source, `${pattern.flags}g`.replace("gg", "g")),
      )) {
        if (test && !test(m as RegExpExecArray)) continue;
        out.push(`${file}:${lineOf(text, m.index ?? 0)} ${m[0].replace(/\s+/g, " ").slice(0, 60)}`);
      }
    }
  }
  return out;
}

describe("design lint", () => {
  it("has some components to read", () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(50);
  });

  it("uses colour tokens, not hex or rgb literals", () => {
    const skip = [...ALLOW.color, ...ALLOW.gallery];
    expect([
      ...scan(
        "style",
        /#[0-9a-fA-F]{3,8}\b(?![\w-])/,
        skip,
        (m) => !/^#[0-9a-fA-F]*[g-zG-Z]/.test(m[0]),
      ),
      ...scan("both", /\brgba?\(/, skip),
    ]).toEqual([]);
  });

  it("uses radius tokens, not px values", () => {
    expect(scan("style", /border-radius:[^;]*\d+px/, ALLOW.gallery)).toEqual([]);
  });

  it("uses --h-* tokens for control heights", () => {
    expect(
      scan("style", /(?<![\w-])(?:min-)?height:\s*(?:2\d|3\d|4[0-4])px/, ALLOW.gallery),
    ).toEqual([]);
  });

  it("uses z-index tokens, not numbers", () => {
    expect(scan("style", /z-index:\s*-?\d+/, ALLOW.gallery)).toEqual([]);
  });

  it("uses Tooltip, not title attributes", () => {
    expect(scan("markup", /<[a-z][\w-]*\b(?:[^<>]|(?<==)>)*?\stitle=/, ALLOW.gallery)).toEqual([]);
  });

  it("uses Icon, not Unicode glyphs, for button content", () => {
    expect(
      scan("markup", /<button\b[^>]*>\s*(?:[✕▥↑↗←▸›−+]|›_)\s*<\/button>/, ALLOW.gallery),
    ).toEqual([]);
  });

  it("keeps the icon font class inside Icon", () => {
    expect(
      scan("both", /material-symbols-outlined/, [
        ...ALLOW.icon,
        ...ALLOW.gallery,
        "components/ui/Checkbox.svelte" /* styles the glyph of the Icon it renders */,
      ]),
    ).toEqual([]);
  });

  it("does not nest buttons or inputs in role=button", () => {
    expect(
      scan("markup", /<(div|span|li|a)\b[^>]*role="button"[^>]*>/, ALLOW.gallery, (m) => {
        const source = m.input.slice((m.index ?? 0) + m[0].length);
        const tag = m[1];
        let depth = 1;
        for (const t of source.matchAll(
          new RegExp(`<(/?)${tag}\\b[^>]*>|<(?:button|input|select)\\b`, "g"),
        )) {
          if (t[0].startsWith("<button") || t[0].startsWith("<input") || t[0].startsWith("<select"))
            return true;
          depth += t[1] ? -1 : 1;
          if (depth === 0) return false;
        }
        return false;
      }),
    ).toEqual([]);
  });

  it("gives clickable non-interactive elements a role and key handler", () => {
    expect(
      scan(
        "markup",
        /<(?:div|span|li|section|article|p|td|tr)\b(?:[^>]|(?<==)>)*?\sonclick=(?:[^>]|(?<==)>)*>/,
        [...ALLOW.gallery, ...ALLOW.click],
        (m) => {
          const tag = m[0];
          /* Backdrops that only close on a direct click are marked presentation. */
          return !(
            /\srole=/.test(tag) &&
            /\sonkeydown=|\sonkeyup=|\sonkeypress=|role="presentation"|role="none"/.test(tag)
          );
        },
      ),
    ).toEqual([]);
  });

  it("uses Select, not native <select>", () => {
    expect(scan("markup", /<select\b/, [...ALLOW.gallery, "components/ui/Select.svelte"])).toEqual(
      [],
    );
  });

  it("uses Atlas dialogs, not window.alert or confirm", () => {
    expect(scan("both", /\b(?:window\.)?(?:alert|confirm)\(/, ALLOW.gallery)).toEqual([]);
  });
});
