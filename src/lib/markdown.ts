/**
 * The documents editor's markdown renderer.
 *
 * Atlas ships no markdown library and this is a documents preview, not a
 * CommonMark implementation — the subset the Files screen renders is small
 * enough that a dependency would cost more than it saves.
 *
 * The output is injected with `{@html}`, so **escaping is the default path**:
 * every run of text is escaped on the way into `inline()` and the markup is
 * spliced into the escaped text afterwards. Nothing reaches the output
 * un-escaped.
 */
import { slugifyPath } from "./files";

/** One h1–h3 for phase 04's outline rail. `id` matches the rendered anchor. */
export interface OutlineItem {
  level: number;
  text: string;
  id: string;
  /** 0-based line the heading is on, so the source pane can scroll to it —
   *  the preview scrolls to `id`, but a textarea has no anchors. */
  line: number;
}

/** Answers whether a `[[wikilink]]` target names a real file. Absent means
 *  every link resolves — the caller has no tree to check it against. */
export type ResolveWikilink = (target: string) => boolean;

const FENCE = /^ {0,3}```(.*)$/;
const HEADING = /^ {0,3}(#{1,3})\s+(.*)$/;

/** A heading line's level and title, or null. The optional closing `#` run is
 *  stripped by hand: a regex for it backtracks quadratically on a long run of
 *  spaces, and this runs on every keystroke via `outline`. */
/** Capture group `n` of a match, or "" if it did not participate. Every regex
 *  here makes its groups unconditional, so the fallback is never taken. */
function group(m: RegExpMatchArray, n: number): string {
  return m[n] ?? "";
}

function parseHeading(line: string): { level: number; title: string } | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  let title = group(m, 2).trim();
  const closing = /#+$/.exec(title);
  if (closing) {
    const before = title.slice(0, closing.index);
    // A closing sequence must follow a space; `C#` keeps its hash.
    if (before === "" || /\s$/.test(before)) title = before.trimEnd();
  }
  return { level: group(m, 1).length, title };
}
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

interface Ctx {
  resolve?: ResolveWikilink;
  /** Heading slugs already used, so a repeated title still gets a unique id. */
  seen: Map<string, number>;
}

export function renderMarkdown(src: string, resolve?: ResolveWikilink): string {
  return renderBlocks(clean(src).split("\n"), { resolve, seen: new Map() });
}

/** h1–h3 in document order. Headings inside a code fence are not headings. */
export function outline(src: string): OutlineItem[] {
  const seen = new Map<string, number>();
  const items: OutlineItem[] = [];
  let fenced = false;
  const lines = clean(src).split("\n");
  for (const [at, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = parseHeading(line);
    if (!heading) continue;
    items.push({
      level: heading.level,
      text: plainText(heading.title),
      id: headingId(heading.title, seen),
      line: at,
    });
  }
  return items;
}

/**
 * Every distinct `[[wikilink]]` target in document order, for the rail's Links
 * section. Fenced code is skipped for the same reason `outline` skips it.
 */
export function wikilinks(src: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  let fenced = false;
  for (const line of clean(src).split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const m of line.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
      const target = group(m, 1).trim();
      const key = target.toLowerCase();
      if (!target || seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
  }
  return targets;
}

function clean(src: string): string {
  return src.replace(/\r\n?/g, "\n");
}

// ---------- Blocks ----------

function renderBlocks(lines: string[], ctx: Ctx): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lineAt(lines, i);
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const lang = group(fence, 1)
        .trim()
        .replace(/[^\w+-]/g, "");
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lineAt(lines, i))) body.push(lineAt(lines, i++));
      // Either the closing fence or one past the end: an unterminated block
      // runs to the end of the document rather than derailing the parse.
      i++;
      const cls = lang ? ` class="language-${lang}"` : "";
      out.push(`<pre class="md-pre"><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      const { level, title } = heading;
      const id = headingId(title, ctx.seen);
      out.push(`<h${level} id="${id}">${inline(title, ctx)}</h${level}>`);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      for (let quoted = QUOTE.exec(line); quoted; quoted = QUOTE.exec(lineAt(lines, i))) {
        body.push(group(quoted, 1));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(body, ctx)}</blockquote>`);
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [html, next] = renderList(lines, i, indentOf(group(item, 1)), ctx);
      out.push(html);
      i = next;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lineAt(lines, i).trim() && !startsBlock(lineAt(lines, i))) {
      para.push(lineAt(lines, i++));
    }
    out.push(`<p>${inline(para.join("\n"), ctx)}</p>`);
  }

  return out.join("\n");
}

/** The line at `i`. Callers bound `i` by `lines.length`, so "" never occurs. */
function lineAt(lines: string[], i: number): string {
  return lines[i] ?? "";
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || ITEM.test(line);
}

/** A tab counts as two columns; only depth relative to the list matters. */
function indentOf(prefix: string): number {
  return prefix.replace(/\t/g, "  ").length;
}

function tagFor(marker: string): "ol" | "ul" {
  return /\d/.test(marker) ? "ol" : "ul";
}

interface Item {
  attrs: string;
  body: string;
}

/** One list at `indent`, returning its html and the line after it. A deeper
 *  item recurses and lands inside the `<li>` above it. */
function renderList(lines: string[], start: number, indent: number, ctx: Ctx): [string, number] {
  const first = ITEM.exec(lineAt(lines, start));
  const tag = tagFor(first ? group(first, 2) : "-");
  const items: Item[] = [];
  let i = start;

  while (i < lines.length) {
    if (!lineAt(lines, i).trim()) {
      // A blank line ends the list unless another item follows at this level
      // or deeper — a loose list is still one list.
      let peek = i;
      while (peek < lines.length && !lineAt(lines, peek).trim()) peek++;
      const next = peek < lines.length ? ITEM.exec(lineAt(lines, peek)) : null;
      if (!next || indentOf(group(next, 1)) < indent) break;
      if (indentOf(group(next, 1)) === indent && tagFor(group(next, 2)) !== tag) break;
      i = peek;
      continue;
    }

    const m = ITEM.exec(lineAt(lines, i));
    if (!m) break;
    const at = indentOf(group(m, 1));
    if (at < indent) break;
    // Switching marker starts a new list rather than a mixed one.
    if (at === indent && tagFor(group(m, 2)) !== tag) break;

    if (at > indent) {
      const [nested, after] = renderList(lines, i, at, ctx);
      const last = items[items.length - 1];
      if (last) last.body += nested;
      else items.push({ attrs: "", body: nested });
      i = after;
      continue;
    }

    items.push(renderItem(group(m, 3), ctx));
    i++;
  }

  const body = items.map((it) => `<li${it.attrs}>${it.body}</li>`).join("");
  return [`<${tag} class="md-list">${body}</${tag}>`, i];
}

function renderItem(content: string, ctx: Ctx): Item {
  const task = TASK.exec(content);
  if (!task) return { attrs: "", body: inline(content, ctx) };
  const done = group(task, 1).toLowerCase() === "x";
  return {
    attrs: ` class="task${done ? " done" : ""}"`,
    body: `<input type="checkbox" disabled${done ? " checked" : ""} /> ${inline(group(task, 2), ctx)}`,
  };
}

function headingId(text: string, seen: Map<string, number>): string {
  const base = slugifyPath(plainText(text)) || "section";
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/** Heading text with its inline markers taken off — what the id and the
 *  outline rail read. Plain data, deliberately not escaped. */
function plainText(src: string): string {
  return src
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[\[([^[\]\n]+)\]\]/g, "$1")
    .replace(/\[([^[\]\n]*)\]\([^()\s]*\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .trim();
}

// ---------- Inline ----------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inverse of `escapeHtml`, for the two places a captured value leaves as data
 *  rather than as markup: a wikilink target, and a url being vetted. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * One run of text: escaped first, then the markup spliced in.
 *
 * Code spans, wikilinks and links are parked in slots as they are recognised,
 * so a later rule cannot reach inside them; the slots go back at the end. `<`
 * cannot occur in escaped text, so a `<0>` marker cannot collide with content.
 */
function inline(src: string, ctx: Ctx): string {
  const slots: string[] = [];
  const hold = (html: string) => `<${slots.push(html) - 1}>`;

  // Links are parked before emphasis runs, so a `*` in a url or wikilink target
  // cannot grow markup inside an attribute; a link label is emphasised on its own.
  let out = emphasis(
    escapeHtml(src)
      .replace(/`([^`]+)`/g, (_m, code) => hold(`<code class="md-code">${code}</code>`))
      .replace(/\[\[([^[\]\n]+)\]\]/g, (_m, target) => hold(wikilink(target, ctx)))
      .replace(/\[([^[\]\n]*)\]\(([^()\s]*)\)/g, (_m, label, href) =>
        hold(anchor(emphasis(label), href)),
      ),
  );

  // A link label can hold a code span, so a slot can hold another slot — two
  // passes is the whole depth of it.
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/<(\d+)>/g, (_m, n) => slots[Number(n)] ?? "");
  }
  return out;
}

function emphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

/** `label` arrives escaped; the resolver wants the text the author typed. */
function wikilink(label: string, ctx: Ctx): string {
  const target = decodeEntities(label).trim();
  if (ctx.resolve && !ctx.resolve(target)) {
    return `<span class="wikilink broken">${label}</span>`;
  }
  // `tabindex` because the anchor has no href — the editor resolves the target
  // itself — and an anchor without one is not in the tab order.
  return `<a class="wikilink" data-wikilink="${label}" tabindex="0">${label}</a>`;
}

function anchor(label: string, href: string): string {
  if (!isSafeHref(decodeEntities(href))) return label;
  return `<a class="md-link" href="${href}">${label}</a>`;
}

/** Relative and fragment urls pass; anything naming a scheme has to name one
 *  of ours, which is what keeps `javascript:` out of an href. */
function isSafeHref(href: string): boolean {
  // Browsers ignore control characters and whitespace inside a scheme, so
  // `\x01javascript:` must be judged as `javascript:`.
  const url = Array.from(href)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join("");
  if (!url) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return /^(https?|mailto):/i.test(url);
  return true;
}
