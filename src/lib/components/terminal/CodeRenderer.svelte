<script lang="ts">
  import hljs from "highlight.js";

  interface Props {
    content: string;
    language: string;
  }

  let { content, language }: Props = $props();

  let rendered = $derived.by(() => {
    const safeContent = content || "";
    if (
      language !== "plaintext" &&
      language !== "unknown" &&
      hljs.getLanguage(language)
    ) {
      try {
        return hljs.highlight(safeContent, { language }).value;
      } catch {
        // fall through
      }
    }
    return safeContent
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  });

  let lineCount = $derived((content || "").split("\n").length);
</script>

<div class="code-view">
  <pre class="hljs code-block"><div class="line-numbers">{#each { length: lineCount } as _, i}<span class="line-num">{i + 1}</span>{/each}</div><code><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html rendered}</code></pre>
</div>

<style>
  .code-view {
    height: 100%;
    overflow: auto;
  }

  .code-block {
    background: var(--surface-container);
    margin: 0;
    padding: 1rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.6;
    display: flex;
    gap: 1rem;
    min-height: 100%;
  }

  .code-block :global(code) {
    background: none;
    padding: 0;
    border-radius: 0;
    color: var(--on-surface);
    flex: 1;
    overflow-x: auto;
    white-space: pre;
  }

  .line-numbers {
    display: flex;
    flex-direction: column;
    text-align: right;
    user-select: none;
    flex-shrink: 0;
  }

  .line-num {
    color: color-mix(in srgb, var(--on-surface-variant) 30%, transparent);
    font-size: 0.75rem;
    line-height: 1.6;
    min-width: 2.5em;
  }

  /* highlight.js token colors */
  .code-block :global(.hljs-keyword),
  .code-block :global(.hljs-selector-tag),
  .code-block :global(.hljs-built_in) {
    color: var(--primary);
  }

  .code-block :global(.hljs-string),
  .code-block :global(.hljs-attr) {
    color: var(--secondary);
  }

  .code-block :global(.hljs-number),
  .code-block :global(.hljs-literal) {
    color: var(--yellow);
  }

  .code-block :global(.hljs-comment),
  .code-block :global(.hljs-quote) {
    color: var(--on-surface-variant);
    font-style: italic;
  }

  .code-block :global(.hljs-title),
  .code-block :global(.hljs-section) {
    color: var(--tertiary);
  }

  .code-block :global(.hljs-type),
  .code-block :global(.hljs-class .hljs-title) {
    color: var(--yellow);
  }

  .code-block :global(.hljs-variable),
  .code-block :global(.hljs-template-variable) {
    color: var(--tertiary);
  }

  .code-block :global(.hljs-meta) {
    color: var(--on-surface-variant);
  }
</style>
