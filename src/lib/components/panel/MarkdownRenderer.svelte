<script lang="ts">
  import MarkdownIt from "markdown-it";
  import hljs from "highlight.js";

  interface Props {
    content: string;
  }

  let { content }: Props = $props();

  const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(str: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
        } catch {
          // fall through
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  });

  let rendered = $derived(md.render(content || ""));
</script>

<div class="markdown-body">
  {@html rendered}
</div>

<style>
  .markdown-body {
    font-family: var(--font-body);
    font-size: 0.875rem;
    line-height: 1.7;
    color: var(--on-surface);
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* Headings */
  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    font-family: var(--font-display);
    font-weight: 700;
    color: var(--on-surface);
    margin: 1.5em 0 0.5em;
    line-height: 1.3;
  }

  .markdown-body :global(h1) {
    font-size: 1.75rem;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--outline-variant);
  }

  .markdown-body :global(h2) {
    font-size: 1.35rem;
    padding-bottom: 0.25em;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 50%, transparent);
  }

  .markdown-body :global(h3) {
    font-size: 1.15rem;
  }

  .markdown-body :global(h4) {
    font-size: 1rem;
  }

  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    font-size: 0.875rem;
    color: var(--on-surface-variant);
  }

  .markdown-body :global(h1:first-child),
  .markdown-body :global(h2:first-child),
  .markdown-body :global(h3:first-child) {
    margin-top: 0;
  }

  /* Paragraphs */
  .markdown-body :global(p) {
    margin: 0 0 1em;
  }

  /* Links */
  .markdown-body :global(a) {
    color: var(--primary);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  /* Bold / Italic */
  .markdown-body :global(strong) {
    font-weight: 600;
    color: var(--on-surface);
  }

  .markdown-body :global(em) {
    font-style: italic;
  }

  /* Inline code */
  .markdown-body :global(code) {
    font-family: var(--font-mono);
    font-size: 0.8em;
    padding: 0.15em 0.4em;
    background: var(--surface-container-high);
    border-radius: var(--radius-sm);
    color: var(--primary);
  }

  /* Code blocks */
  .markdown-body :global(pre.hljs) {
    background: var(--surface-container);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius);
    padding: 1rem;
    margin: 0 0 1em;
    overflow-x: auto;
  }

  .markdown-body :global(pre.hljs code) {
    background: none;
    padding: 0;
    border-radius: 0;
    color: var(--on-surface);
    font-size: 0.8rem;
    line-height: 1.6;
  }

  /* highlight.js token colors — matches dark theme */
  .markdown-body :global(.hljs-keyword),
  .markdown-body :global(.hljs-selector-tag),
  .markdown-body :global(.hljs-built_in) {
    color: var(--primary);
  }

  .markdown-body :global(.hljs-string),
  .markdown-body :global(.hljs-attr) {
    color: var(--secondary);
  }

  .markdown-body :global(.hljs-number),
  .markdown-body :global(.hljs-literal) {
    color: var(--yellow);
  }

  .markdown-body :global(.hljs-comment),
  .markdown-body :global(.hljs-quote) {
    color: var(--on-surface-variant);
    font-style: italic;
  }

  .markdown-body :global(.hljs-title),
  .markdown-body :global(.hljs-section) {
    color: var(--tertiary);
  }

  .markdown-body :global(.hljs-type),
  .markdown-body :global(.hljs-class .hljs-title) {
    color: var(--yellow);
  }

  .markdown-body :global(.hljs-variable),
  .markdown-body :global(.hljs-template-variable) {
    color: var(--tertiary);
  }

  .markdown-body :global(.hljs-meta) {
    color: var(--on-surface-variant);
  }

  /* Blockquotes */
  .markdown-body :global(blockquote) {
    margin: 0 0 1em;
    padding: 0.5rem 1rem;
    border-left: 3px solid var(--primary);
    background: color-mix(in srgb, var(--primary) 5%, transparent);
    color: var(--on-surface-variant);
  }

  .markdown-body :global(blockquote p:last-child) {
    margin-bottom: 0;
  }

  /* Lists */
  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin: 0 0 1em;
    padding-left: 1.5em;
  }

  .markdown-body :global(li) {
    margin-bottom: 0.25em;
  }

  .markdown-body :global(li > ul),
  .markdown-body :global(li > ol) {
    margin-bottom: 0;
  }

  /* Tables */
  .markdown-body :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1em;
    font-size: 0.8rem;
  }

  .markdown-body :global(th) {
    font-weight: 600;
    text-align: left;
    padding: 0.5rem 0.75rem;
    background: var(--surface-container-high);
    border-bottom: 2px solid var(--outline-variant);
    color: var(--on-surface);
  }

  .markdown-body :global(td) {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 50%, transparent);
  }

  .markdown-body :global(tr:hover td) {
    background: color-mix(in srgb, var(--surface-container-high) 50%, transparent);
  }

  /* Horizontal rules */
  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--outline-variant);
    margin: 1.5em 0;
  }

  /* Images */
  .markdown-body :global(img) {
    max-width: 100%;
    border-radius: var(--radius);
  }

  /* Task lists (GFM-style) */
  .markdown-body :global(li input[type="checkbox"]) {
    margin-right: 0.5em;
  }
</style>
