import { describe, expect, it } from "vitest";

import { outline, renderMarkdown, wikilinks } from "../markdown";

describe("renderMarkdown", () => {
  it("renders h1–h3 with ids and leaves deeper hashes as text", () => {
    const html = renderMarkdown("# One\n\n## Two\n\n### Three\n\n#### Four");
    expect(html).toContain('<h1 id="one">One</h1>');
    expect(html).toContain('<h2 id="two">Two</h2>');
    expect(html).toContain('<h3 id="three">Three</h3>');
    expect(html).toContain("<p>#### Four</p>");
  });

  it("gives a repeated heading a unique id", () => {
    const html = renderMarkdown("# Notes\n\n# Notes");
    expect(html).toContain('id="notes"');
    expect(html).toContain('id="notes-2"');
  });

  it("joins a paragraph's lines and splits on a blank line", () => {
    const html = renderMarkdown("one\ntwo\n\nthree");
    expect(html).toContain("<p>one\ntwo</p>");
    expect(html).toContain("<p>three</p>");
  });

  it("renders bullet and numbered lists", () => {
    expect(renderMarkdown("- a\n- b")).toContain('<ul class="md-list"><li>a</li><li>b</li></ul>');
    expect(renderMarkdown("1. a\n2. b")).toContain('<ol class="md-list"><li>a</li><li>b</li></ol>');
  });

  it("nests a deeper list inside the item above it", () => {
    const html = renderMarkdown("- a\n  - a1\n  - a2\n- b");
    expect(html).toBe(
      '<ul class="md-list">' +
        '<li>a<ul class="md-list"><li>a1</li><li>a2</li></ul></li>' +
        "<li>b</li>" +
        "</ul>",
    );
  });

  it("starts a new list when the marker changes", () => {
    const html = renderMarkdown("- a\n\n1. b");
    expect(html).toContain('<ul class="md-list"><li>a</li></ul>');
    expect(html).toContain('<ol class="md-list"><li>b</li></ol>');
  });

  it("renders checkbox items in both states", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done");
    expect(html).toContain('<li class="task"><input type="checkbox" disabled /> todo</li>');
    expect(html).toContain(
      '<li class="task done"><input type="checkbox" disabled checked /> done</li>',
    );
  });

  it("renders a blockquote's contents as blocks", () => {
    const html = renderMarkdown("> ## Heads up\n> body");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<h2 id="heads-up">Heads up</h2>');
    expect(html).toContain("<p>body</p>");
  });

  it("renders a fenced code block with its language", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toBe('<pre class="md-pre"><code class="language-ts">const a = 1;</code></pre>');
  });

  it("runs an unterminated fence to the end of the document", () => {
    const html = renderMarkdown("text\n\n```\nstill code\n# not a heading");
    expect(html).toContain("<p>text</p>");
    expect(html).toContain('<pre class="md-pre"><code>still code\n# not a heading</code></pre>');
    expect(html).not.toContain("<h1");
  });

  it("renders inline code, bold and italic", () => {
    const html = renderMarkdown("a `b` **c** *d*");
    expect(html).toBe('<p>a <code class="md-code">b</code> <strong>c</strong> <em>d</em></p>');
  });

  it("leaves markdown inside a code span alone", () => {
    expect(renderMarkdown("`**not bold**`")).toContain('<code class="md-code">**not bold**</code>');
  });

  it("renders a link and drops a javascript: url", () => {
    expect(renderMarkdown("[site](https://example.com)")).toContain(
      '<a class="md-link" href="https://example.com">site</a>',
    );
    const nasty = renderMarkdown("[click](javascript:alert1)");
    expect(nasty).toBe("<p>click</p>");
  });

  it("renders a wikilink as an anchor carrying its target", () => {
    expect(renderMarkdown("see [[Design Notes]] first")).toContain(
      '<a class="wikilink" data-wikilink="Design Notes">Design Notes</a>',
    );
  });

  it("renders an unresolved wikilink inert", () => {
    const html = renderMarkdown("[[Ghost]]", (target) => target === "Real");
    expect(html).toContain('<span class="wikilink broken">Ghost</span>');
    expect(html).not.toContain("<a");
  });

  it("hands the resolver the target the author typed", () => {
    const seen: string[] = [];
    renderMarkdown("[[Q&A]]", (target) => {
      seen.push(target);
      return true;
    });
    expect(seen).toEqual(["Q&A"]);
  });
});

describe("renderMarkdown escaping", () => {
  const SCRIPT = "<script>alert(1)</script>";

  it("escapes a script tag in a paragraph", () => {
    const html = renderMarkdown(SCRIPT);
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("escapes a script tag in a heading", () => {
    expect(renderMarkdown(`# ${SCRIPT}`)).not.toContain("<script");
  });

  it("escapes a script tag in a code fence", () => {
    const html = renderMarkdown("```\n" + SCRIPT + "\n```");
    expect(html).toBe(
      '<pre class="md-pre"><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
    );
  });

  it("escapes a script tag in a link label and a list item", () => {
    expect(renderMarkdown(`[${SCRIPT}](https://example.com)`)).not.toContain("<script");
    expect(renderMarkdown(`- ${SCRIPT}`)).not.toContain("<script");
  });

  it("cannot be broken out of an href", () => {
    const html = renderMarkdown('[x](https://e.com"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover="');
  });
});

describe("outline", () => {
  it("lists h1–h3 with the ids the renderer used", () => {
    const src = "# Title\n\ntext\n\n## Part one\n\n### Deep\n\n## Part one";
    expect(outline(src)).toEqual([
      { level: 1, text: "Title", id: "title", line: 0 },
      { level: 2, text: "Part one", id: "part-one", line: 4 },
      { level: 3, text: "Deep", id: "deep", line: 6 },
      { level: 2, text: "Part one", id: "part-one-2", line: 8 },
    ]);
    const html = renderMarkdown(src);
    for (const item of outline(src)) expect(html).toContain(`id="${item.id}"`);
  });

  it("ignores a heading inside a code fence", () => {
    expect(outline("```\n# Nope\n```\n\n# Yes")).toEqual([
      { level: 1, text: "Yes", id: "yes", line: 4 },
    ]);
  });

  it("strips inline markers from the text it reports", () => {
    expect(outline("## The `run` **loop**")).toEqual([
      { level: 2, text: "The run loop", id: "the-run-loop", line: 0 },
    ]);
  });
});

describe("wikilinks", () => {
  it("lists every distinct target in document order", () => {
    const src = "See [[Guide]] and [[notes/todo]].\n\nAgain [[guide]] — same target.";
    expect(wikilinks(src)).toEqual(["Guide", "notes/todo"]);
  });

  it("ignores a link inside a code fence", () => {
    expect(wikilinks("```\n[[Nope]]\n```\n\n[[Yes]]")).toEqual(["Yes"]);
  });

  it("finds nothing in a document with no links", () => {
    expect(wikilinks("# Title\n\nJust prose.")).toEqual([]);
  });
});
