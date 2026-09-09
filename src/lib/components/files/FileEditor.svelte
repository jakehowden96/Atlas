<script lang="ts">
  /**
   * The Files screen's middle column: tabs, toolbar, the document itself and a
   * status footer.
   *
   * A documents editor, not a code editor — the source pane is a textarea, and
   * the preview is `markdown.ts` rather than a full CommonMark renderer.
   */
  import { untrack } from "svelte";
  import { absolutePath, parseFileKey, resolveWikilink } from "../../files";
  import { basename, formatAgo } from "../../format";
  import { openUrl } from "../../ipc";
  import { renderMarkdown } from "../../markdown";
  import { chords } from "../../stores/settings";
  import {
    activeFile,
    closeFile,
    dirtyFiles,
    diskDocs,
    docEntries,
    docs,
    fileMode,
    fileWs,
    loadFileText,
    openFile,
    openFiles,
    outlineJump,
    plans,
    saveActiveFile,
    setDoc,
  } from "../../stores/files";
  import { fileRailOpen, openNewSession } from "../../stores/view";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";

  let key = $derived($activeFile);
  let file = $derived(parseFileKey(key));
  /** The unsaved edit if there is one, else the text last read from disk. */
  let text = $derived($docs.get(key) ?? $diskDocs.get(key) ?? "");
  let dirty = $derived($dirtyFiles.has(key));
  let markdown = $derived(/\.(md|markdown)$/i.test(file.path));
  /** Preview is markdown-only, so a `.txt` always shows its source. */
  let mode = $derived(markdown ? $fileMode : "source");

  let modeOptions = $derived<Segment[]>([
    { id: "source", label: "Source" },
    { id: "split", label: "Split" },
    { id: "preview", label: "Preview", disabled: !markdown },
  ]);

  let files = $derived($docEntries.filter((e) => !e.is_dir));
  let html = $derived(
    mode === "source" ? "" : renderMarkdown(text, (t) => resolveWikilink(t, files) !== null),
  );

  let sourceEl = $state<HTMLTextAreaElement | null>(null);
  let previewEl = $state<HTMLDivElement | null>(null);

  /** Long paths would push the toolbar's controls off; the tail is the part
   *  that identifies the file. */
  let crumbs = $derived(file.path.split(/[\\/]/).filter(Boolean).slice(-3));

  let kind = $derived(markdown ? "Markdown" : /\.txt$/i.test(file.path) ? "Text" : "Document");
  let lines = $derived(text ? text.split("\n").length : 0);
  let words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
  let modified = $derived.by(() => {
    const stamp =
      file.source === "plans"
        ? $plans.find((p) => p.path === file.path)?.modified
        : $docEntries.find((e) => e.rel_path === file.path)?.modified;
    const at = stamp ? Date.parse(stamp) : Number.NaN;
    return Number.isNaN(at) ? "—" : formatAgo(at, Date.now());
  });

  // `openFiles` is persisted but the active tab is not, so a restored session
  // — and a closed last tab — needs one picked here.
  $effect(() => {
    const open = $openFiles;
    if (open.length === 0) {
      if ($activeFile) activeFile.set("");
      return;
    }
    if (!open.includes($activeFile)) activeFile.set(open[0]);
  });

  // Pull the file off disk the first time it is shown. `loadFileText` is a
  // no-op once the text is known, so this only fires on a genuinely new tab.
  $effect(() => {
    void loadFileText($activeFile);
  });

  /**
   * Scroll to a heading the outline rail was clicked on.
   *
   * Only the jump itself is a dependency — everything the scroll reads is
   * untracked, or typing in the source pane would yank the caret back to the
   * last heading on every keystroke.
   */
  $effect(() => {
    const jump = $outlineJump;
    if (jump) untrack(() => scrollToHeading(jump));
  });

  function scrollToHeading(jump: { id: string; line: number }) {
    // The preview has real anchors; a textarea has none, so the source pane is
    // scrolled by putting the caret on the heading's line instead.
    const anchor = previewEl?.querySelector(`#${CSS.escape(jump.id)}`);
    if (anchor) {
      anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!sourceEl) return;
    const offset = text
      .split("\n")
      .slice(0, jump.line)
      .reduce((n, line) => n + line.length + 1, 0);
    sourceEl.focus();
    sourceEl.setSelectionRange(offset, offset);
  }

  function onPreviewClick(e: MouseEvent) {
    const anchor = (e.target as HTMLElement | null)?.closest?.("a");
    if (!anchor) return;
    // Either way the webview must not navigate — it would replace the app.
    e.preventDefault();
    const wiki = anchor.getAttribute("data-wikilink");
    if (wiki) {
      const rel = resolveWikilink(wiki, files);
      if (rel) openFile($fileWs, rel);
      return;
    }
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) void openUrl(href);
  }

  function askClaude() {
    if (!key) return;
    const workspacePath = file.source === "plans" || file.source === "disk" ? $fileWs : file.source;
    openNewSession({ workspacePath, attachPath: absolutePath(file.source, file.path) });
  }
</script>

<div class="editor">
  {#if $openFiles.length === 0}
    <p class="blank">No file open</p>
  {:else}
    <div class="tabs">
      {#each $openFiles as tab (tab)}
        {@const f = parseFileKey(tab)}
        <div class="tab" class:active={tab === $activeFile}>
          <button
            type="button"
            class="tab-name"
            title={absolutePath(f.source, f.path)}
            onclick={() => activeFile.set(tab)}
          >
            {basename(f.path)}
          </button>
          {#if $dirtyFiles.has(tab)}<span class="dot"></span>{/if}
          <button
            type="button"
            class="tab-close"
            aria-label="Close {basename(f.path)}"
            onclick={() => closeFile(tab)}>✕</button
          >
        </div>
      {/each}
    </div>

    <div class="toolbar">
      <span class="crumbs">
        {#each crumbs as crumb, i (i)}
          {#if i > 0}<span class="sep">/</span>{/if}
          <span class="crumb" class:leaf={i === crumbs.length - 1}>{crumb}</span>
        {/each}
      </span>
      {#if dirty}<span class="pill">Unsaved</span>{/if}

      <div class="spacer"></div>

      <SegmentedControl
        options={modeOptions}
        value={mode}
        size="sm"
        onChange={(id) => fileMode.set(id as "source" | "split" | "preview")}
      />
      <button type="button" class="ask" onclick={askClaude}>
        Ask Claude <span class="glyph">›_</span>
      </button>
      <button
        type="button"
        class="save"
        class:on={dirty}
        disabled={!dirty}
        onclick={() => void saveActiveFile()}
      >
        Save <span class="kbd">{$chords.saveFile}</span>
      </button>
      <button
        type="button"
        class="rail-toggle"
        class:on={$fileRailOpen}
        title="File rail"
        aria-label="Toggle the file rail"
        onclick={() => fileRailOpen.update((v) => !v)}
      >
        <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <rect
            x="1.6"
            y="2.6"
            width="10.8"
            height="8.8"
            rx="1.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <line x1="9.2" y1="2.6" x2="9.2" y2="11.4" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>

    <div class="body">
      {#if mode !== "preview"}
        <!-- A plain textarea stands in for CodeMirror 6, which the spec calls
             the eventual home of this pane. Not a dependency worth adding for
             a documents editor that has no syntax highlighting to show. -->
        <textarea
          bind:this={sourceEl}
          class="source"
          spellcheck="false"
          value={text}
          oninput={(e) => setDoc(key, e.currentTarget.value)}
        ></textarea>
      {/if}
      {#if mode !== "source"}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={previewEl}
          class="preview"
          class:split={mode === "split"}
          onclick={onPreviewClick}
        >
          <div class="page">{@html html}</div>
        </div>
      {/if}
    </div>

    <div class="footer">
      {kind} · {lines} lines · {words} words · modified {modified}
    </div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--surface);
  }

  .blank {
    display: grid;
    flex: 1;
    place-items: center;
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }

  /* ── Tabs ──────────────────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    flex-shrink: 0;
    height: 36px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 200px;
    padding: 0 8px 0 12px;
    border-right: 1px solid var(--border);
    color: var(--muted);
  }

  .tab.active {
    background: var(--surface);
    box-shadow: inset 0 -2px 0 var(--accent);
    color: var(--text);
  }

  .tab-name {
    min-width: 0;
    overflow: hidden;
    color: inherit;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warn);
  }

  .tab-close {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }

  .tab-close:hover {
    color: var(--text);
  }

  /* ── Toolbar ───────────────────────────────────────────────────────────── */
  .toolbar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .crumb,
  .sep {
    color: var(--muted);
  }

  .crumb.leaf {
    color: var(--text);
  }

  .pill {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 9px;
    background: var(--surface2);
    color: var(--warn);
    font-size: 10.5px;
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .ask,
  .save {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--muted);
    font-size: 11.5px;
    cursor: pointer;
  }

  .ask:hover {
    color: var(--text);
  }

  .glyph {
    font-family: var(--font-mono);
    font-weight: 600;
  }

  .rail-toggle {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--muted);
    cursor: pointer;
  }

  .rail-toggle:hover,
  .rail-toggle.on {
    color: var(--text);
  }

  .save.on {
    border-color: transparent;
    background: var(--ink);
    color: var(--ink-text);
  }

  .save:disabled {
    cursor: default;
  }

  .kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }

  /* ── Body ──────────────────────────────────────────────────────────────── */
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .source {
    flex: 1;
    min-width: 0;
    padding: 24px 28px;
    border: none;
    outline: none;
    background: var(--term-bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.7;
    resize: none;
    tab-size: 2;
  }

  .preview {
    flex: 1;
    min-width: 0;
    padding: 24px 28px;
    overflow-y: auto;
  }

  .preview.split {
    border-left: 1px solid var(--border);
  }

  .page {
    max-width: 640px;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 14px;
    line-height: 1.65;
  }

  .footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
  }

  /* ── Rendered markdown ─────────────────────────────────────────────────── */
  .page :global(h1) {
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
    font-size: 24px;
    font-weight: 600;
  }

  .page :global(h2) {
    margin: 24px 0 8px;
    font-size: 18px;
    font-weight: 600;
  }

  .page :global(h3) {
    margin: 20px 0 6px;
    font-size: 15px;
    font-weight: 600;
  }

  .page :global(p) {
    margin: 0 0 12px;
    white-space: pre-wrap;
  }

  .page :global(.md-list) {
    margin: 0 0 12px;
    padding-left: 22px;
  }

  .page :global(li) {
    margin-bottom: 3px;
  }

  .page :global(li.task) {
    list-style: none;
    margin-left: -18px;
  }

  .page :global(li.task input) {
    margin-right: 6px;
    accent-color: var(--accent);
  }

  .page :global(li.task.done) {
    color: var(--muted);
    text-decoration: line-through;
  }

  .page :global(blockquote) {
    margin: 0 0 12px;
    padding-left: 12px;
    border-left: 2px solid var(--accent);
    color: var(--muted);
  }

  .page :global(.md-code) {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: var(--surface2);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .page :global(.md-pre) {
    margin: 0 0 12px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--term-bg);
    overflow-x: auto;
  }

  .page :global(.md-pre code) {
    color: var(--term-text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
  }

  .page :global(.md-link),
  .page :global(.wikilink) {
    color: var(--accent);
    cursor: pointer;
  }

  .page :global(.wikilink.broken) {
    color: var(--muted);
    cursor: default;
  }
</style>
