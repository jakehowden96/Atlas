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
}

/** Answers whether a `[[wikilink]]` target names a real file. Absent means
 *  every link resolves — the caller has no tree to check it against. */
export type ResolveWikilink = (target: string) => boolean;

const FENCE = /^ {0,3}```(.*)$/;
const HEADING = /^ {0,3}(#{1,3})\s+(.*?)\s*#*\s*$/;
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
  for (const line of clean(src).split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = HEADING.exec(line);
    if (!m) continue;
    items.push({ level: m[1].length, text: plainText(m[2]), id: headingId(m[2], seen) });
  }
  return items;
}

function clean(src: string): string {
  return src.replace(/\r\n?/g, "\n");
}

// ---------- Blocks ----------

function renderBlocks(lines: string[], ctx: Ctx): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1].trim().replace(/[^\w+-]/g, "");
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      // Either the closing fence or one past the end: an unterminated block
      // runs to the end of the document rather than derailing the parse.
      i++;
      const cls = lang ? ` class="language-${lang}"` : "";
      out.push(`<pre class="md-pre"><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const id = headingId(heading[2], ctx.seen);
      out.push(`<h${level} id="${id}">${inline(heading[2], ctx)}</h${level}>`);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
        i++;
      }
      out.push(`<blockquote>${renderBlocks(body, ctx)}</blockquote>`);
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [html, next] = renderList(lines, i, indentOf(item[1]), ctx);
      out.push(html);
      i = next;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join("\n"), ctx)}</p>`);
  }

  return out.join("\n");
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
  const first = ITEM.exec(lines[start]) as RegExpExecArray;
  const tag = tagFor(first[2]);
  const items: Item[] = [];
  let i = start;

  while (i < lines.length) {
    if (!lines[i].trim()) {
      // A blank line ends the list unless another item follows at this level
      // or deeper — a loose list is still one list.
      let peek = i;
      while (peek < lines.length && !lines[peek].trim()) peek++;
      const next = peek < lines.length ? ITEM.exec(lines[peek]) : null;
      if (!next || indentOf(next[1]) < indent) break;
      if (indentOf(next[1]) === indent && tagFor(next[2]) !== tag) break;
      i = peek;
      continue;
    }

    const m = ITEM.exec(lines[i]);
    if (!m) break;
    const at = indentOf(m[1]);
    if (at < indent) break;
    // Switching marker starts a new list rather than a mixed one.
    if (at === indent && tagFor(m[2]) !== tag) break;

    if (at > indent) {
      const [nested, after] = renderList(lines, i, at, ctx);
      const last = items[items.length - 1];
      if (last) last.body += nested;
      else items.push({ attrs: "", body: nested });
      i = after;
      continue;
    }

    items.push(renderItem(m[3], ctx));
    i++;
  }

  const body = items.map((it) => `<li${it.attrs}>${it.body}</li>`).join("");
  return [`<${tag} class="md-list">${body}</${tag}>`, i];
}

function renderItem(content: string, ctx: Ctx): Item {
  const task = TASK.exec(content);
  if (!task) return { attrs: "", body: inline(content, ctx) };
  const done = task[1].toLowerCase() === "x";
  return {
    attrs: ` class="task${done ? " done" : ""}"`,
    body: `<input type="checkbox" disabled${done ? " checked" : ""} /> ${inline(task[2], ctx)}`,
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

  let out = escapeHtml(src)
    .replace(/`([^`]+)`/g, (_m, code) => hold(`<code class="md-code">${code}</code>`))
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/\[\[([^[\]\n]+)\]\]/g, (_m, target) => hold(wikilink(target, ctx)))
    .replace(/\[([^[\]\n]*)\]\(([^()\s]*)\)/g, (_m, label, href) => hold(anchor(label, href)));

  // A link label can hold a code span, so a slot can hold another slot — two
  // passes is the whole depth of it.
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/<(\d+)>/g, (_m, n) => slots[Number(n)] ?? "");
  }
  return out;
}

/** `label` arrives escaped; the resolver wants the text the author typed. */
function wikilink(label: string, ctx: Ctx): string {
  const target = decodeEntities(label).trim();
  if (ctx.resolve && !ctx.resolve(target)) {
    return `<span class="wikilink broken">${label}</span>`;
  }
  return `<a class="wikilink" data-wikilink="${label}">${label}</a>`;
}

function anchor(label: string, href: string): string {
  if (!isSafeHref(decodeEntities(href))) return label;
  return `<a class="md-link" href="${href}">${label}</a>`;
}

/** Relative and fragment urls pass; anything naming a scheme has to name one
 *  of ours, which is what keeps `javascript:` out of an href. */
function isSafeHref(href: string): boolean {
  const url = href.trim();
  if (!url) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return /^(https?|mailto):/i.test(url);
  return true;
}
