<script lang="ts">
  import { get } from "svelte/store";
  import { parseDiff, type DiffFile } from "../../diff-parser";
  import {
    cssEscape,
    dedupeKeys,
    renderRawForFile,
    toFlat,
    type FlatFile,
  } from "../../diff-view";
  import type { DiffData } from "../../../types/panel";
  import { refreshPanel } from "../../ipc";
  import { panelData } from "../../stores/panel";
  import { activeTabId } from "../../stores/terminal";
  import { showToast } from "../../stores/toast";
  import {
    activeSessionComments,
    addComment,
    removeComment,
    anchorDomKey,
    type ReviewAnchor,
    type ReviewComment,
  } from "../../stores/reviewComments";
  import RepositoryClean from "./RepositoryClean.svelte";
  import DiffFileTree from "./DiffFileTree.svelte";
  import DiffFileCard from "./DiffFileCard.svelte";

  interface Props {
    data: DiffData | undefined;
    cwd: string;
  }

  let { data, cwd }: Props = $props();

  let refreshing = $state(false);
  async function handleRefresh() {
    if (refreshing || !cwd) return;
    refreshing = true;
    try {
      const fresh = await refreshPanel(get(activeTabId), cwd);
      panelData.set(fresh);
    } catch (e) {
      showToast(`Refresh failed: ${e}`);
    } finally {
      refreshing = false;
    }
  }

  // ---------- Local/Remote toggle (preserves existing behavior) ----------
  let diffView = $state<"local" | "remote">("remote");
  let hasLocalToggle = $derived(!!data?.local_raw && data.local_raw !== data.raw);

  $effect(() => {
    if (!hasLocalToggle && diffView !== "remote") {
      diffView = "remote";
    }
  });

  let activeRaw = $derived(
    hasLocalToggle && diffView === "local" ? data!.local_raw! : data?.raw
  );

  // Memoize parseDiff
  let lastRaw = "";
  let lastFiles: DiffFile[] = [];
  let files = $derived.by(() => {
    const raw = activeRaw ?? "";
    if (raw === lastRaw) return lastFiles;
    lastRaw = raw;
    lastFiles = raw ? parseDiff(raw) : [];
    return lastFiles;
  });

  let lastProjectsKey = "";
  let lastProjectFiles: { name: string; raw: string; files_changed: number; lines_added: number; lines_removed: number; files: DiffFile[] }[] = [];
  let projectFiles = $derived.by(() => {
    const projects = data?.projects;
    if (!projects) return [];
    const key = projects.map((p) => p.raw).join("\0");
    if (key === lastProjectsKey) return lastProjectFiles;
    lastProjectsKey = key;
    lastProjectFiles = projects.map((p) => ({ ...p, files: parseDiff(p.raw) }));
    return lastProjectFiles;
  });

  let isMultiRepo = $derived(projectFiles.length > 0);

  type ProjectFlat = {
    project: { name: string; files_changed: number; lines_added: number; lines_removed: number };
    items: FlatFile[];
  };
  let projectFlat = $derived<ProjectFlat[]>(
    isMultiRepo
      ? projectFiles.map((p) => ({
          project: { name: p.name, files_changed: p.files_changed, lines_added: p.lines_added, lines_removed: p.lines_removed },
          items: dedupeKeys(p.files.map((f) => toFlat(f, `${p.name}/${f.newName}`))),
        }))
      : []
  );
  let flatFiles = $derived<FlatFile[]>(
    isMultiRepo
      ? projectFlat.flatMap((pf) => pf.items)
      : dedupeKeys(files.map((f) => toFlat(f, f.newName)))
  );

  // ---------- difit-style viewed state ----------
  let viewedFiles: Set<string> = $state(new Set());
  let lastViewedResetKey = "";

  $effect(() => {
    const resetKey = cwd + "\0" + (data?.raw ?? "");
    if (resetKey !== lastViewedResetKey) {
      lastViewedResetKey = resetKey;
      viewedFiles = new Set();
    }
  });

  function toggleViewed(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(viewedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    viewedFiles = next;
  }

  let viewedCount = $derived(flatFiles.filter((f) => viewedFiles.has(f.key)).length);

  // ---------- Toolbar state ----------
  let diffMode = $state<"split" | "unified">("unified");
  let copiedAll = $state(false);
  let isFileTreeOpen = $state(true);

  async function copyAllPrompts() {
    const prompt = flatFiles
      .map((f) => `// File: ${f.key}\n${renderRawForFile(f.file)}`)
      .join("\n\n");
    try {
      await navigator.clipboard?.writeText(prompt);
      copiedAll = true;
      setTimeout(() => (copiedAll = false), 1400);
    } catch {
      // Clipboard unavailable (denied / non-secure context) — silently no-op
    }
  }

  // Scroll-to-file when clicking tree entry
  function scrollToFile(key: string) {
    const id = "diff-file-" + cssEscape(key);
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Per-file collapse ----------
  // userCollapsed: the user clicked the header to hide a file
  // expandedFiles: the user clicked "Show N lines" to override the size-based auto-collapse
  // Both reset when the diff changes (cheap to redo).
  let userCollapsed: Set<string> = $state(new Set());
  let expandedFiles: Set<string> = $state(new Set());
  let lastCollapseResetKey = "";

  $effect(() => {
    const resetKey = cwd + "\0" + (data?.raw ?? "");
    if (resetKey !== lastCollapseResetKey) {
      lastCollapseResetKey = resetKey;
      userCollapsed = new Set();
      expandedFiles = new Set();
    }
  });

  function toggleUserCollapsed(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(userCollapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    userCollapsed = next;
  }

  function toggleExpand(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(expandedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedFiles = next;
  }

  // ---------- Review comments ----------
  // composerKey identifies the line whose inline composer is open. Null when no
  // composer is showing. The key matches anchorDomKey() so badge rendering can
  // look up "is the composer open right here?" cheaply.
  let composerKey = $state<string | null>(null);

  // Group active-session comments by anchor key for fast badge rendering.
  let commentsByAnchorKey = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const m = new Map<string, ReviewComment[]>();
    for (const c of $activeSessionComments) {
      const k = anchorDomKey(c.anchor);
      const list = m.get(k) ?? [];
      list.push(c);
      m.set(k, list);
    }
    return m;
  });

  function openComposer(anchor: ReviewAnchor) {
    composerKey = anchorDomKey(anchor);
  }

  function closeComposer() {
    composerKey = null;
  }

  function saveComment(anchor: ReviewAnchor, body: string) {
    const sid = get(activeTabId);
    if (!sid) return;
    addComment(sid, anchor, body);
    closeComposer();
  }

  function dismissComment(id: string) {
    const sid = get(activeTabId);
    if (!sid) return;
    removeComment(sid, id);
  }
</script>

<div class="diff-viewer">
  {#if data}
    <!-- Top toolbar (difit-style) -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button
          class="icon-btn"
          class:active={isFileTreeOpen}
          onclick={() => (isFileTreeOpen = !isFileTreeOpen)}
          title={isFileTreeOpen ? "Hide file list" : "Show file list"}
        >
          <span class="material-symbols-outlined">{isFileTreeOpen ? "left_panel_close" : "left_panel_open"}</span>
        </button>
        <div class="mode-group" role="group" aria-label="View mode">
          <button class="mode-btn" class:active={diffMode === "split"} onclick={() => (diffMode = "split")}>
            <span class="material-symbols-outlined">view_column</span>
            <span>Side by Side</span>
          </button>
          <button class="mode-btn" class:active={diffMode === "unified"} onclick={() => (diffMode = "unified")}>
            <span class="material-symbols-outlined">notes</span>
            <span>Unified</span>
          </button>
        </div>
        <button
          class="icon-btn"
          onclick={handleRefresh}
          disabled={refreshing}
          title="Refresh diff"
          aria-label="Refresh diff"
        >
          <span class="material-symbols-outlined" class:spinning={refreshing}>refresh</span>
        </button>
      </div>
      <div class="toolbar-right">
        <button class="copy-all-btn" class:copied={copiedAll} onclick={copyAllPrompts} title="Copy all prompts">
          <span class="material-symbols-outlined">{copiedAll ? "check" : "content_copy"}</span>
          <span>{copiedAll ? "Copied" : "Copy All Prompts"}</span>
        </button>
        <div class="viewed-counter">
          <span class="viewed-num">{viewedCount}</span>
          <span class="viewed-sep">/</span>
          <span class="viewed-total">{flatFiles.length}</span>
          <span class="viewed-label">files viewed</span>
        </div>
      </div>
    </div>

    {#if hasLocalToggle}
      <div class="diff-toggle-bar">
        <button class="diff-toggle-pill" class:active={diffView === "local"} onclick={() => diffView = "local"}>Local</button>
        <button class="diff-toggle-pill" class:active={diffView === "remote"} onclick={() => diffView = "remote"}>Remote</button>
      </div>
    {/if}

    <div class="body" class:tree-open={isFileTreeOpen}>
      {#if isFileTreeOpen}
        <DiffFileTree {flatFiles} {viewedFiles} onSelectFile={scrollToFile} />
      {/if}

      <div class="diff-stream">
        {#if isMultiRepo}
          {#each projectFlat as pf (pf.project.name)}
            <div class="project-section">
              <header class="project-banner">
                <span class="project-name">{pf.project.name}</span>
                <span class="project-stats">
                  <span class="stat files">{pf.project.files_changed} file{pf.project.files_changed !== 1 ? "s" : ""}</span>
                  <span class="stat added">+{pf.project.lines_added}</span>
                  <span class="stat removed">-{pf.project.lines_removed}</span>
                </span>
              </header>
              {#each pf.items as item (item.key)}
                {@render fileCard(item)}
              {/each}
            </div>
          {/each}
        {:else}
          {#each flatFiles as item (item.key)}
            {@render fileCard(item)}
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <RepositoryClean />
  {/if}
</div>

{#snippet fileCard(item: FlatFile)}
  <DiffFileCard
    {item}
    {diffMode}
    viewed={viewedFiles.has(item.key)}
    userCollapsed={userCollapsed.has(item.key)}
    expanded={expandedFiles.has(item.key)}
    {commentsByAnchorKey}
    {composerKey}
    onToggleViewed={toggleViewed}
    onToggleCollapsed={toggleUserCollapsed}
    onToggleExpand={toggleExpand}
    onOpenComposer={openComposer}
    onCloseComposer={closeComposer}
    onSaveComment={saveComment}
    onDismissComment={dismissComment}
  />
{/snippet}

<style>
  /* ============ difit color palette (GitHub-like, themed via tokens) ============
     The --diff-* custom properties are consumed by DiffFileCard via inheritance. */
  .diff-viewer {
    --diff-add-bg: color-mix(in srgb, var(--secondary) 12%, var(--surface));
    --diff-add-fg: color-mix(in srgb, var(--secondary) 85%, var(--on-surface));
    --diff-add-num-bg: color-mix(in srgb, var(--secondary) 18%, var(--surface-container-low));
    --diff-rem-bg: color-mix(in srgb, var(--error) 10%, var(--surface));
    --diff-rem-fg: color-mix(in srgb, var(--error) 85%, var(--on-surface));
    --diff-rem-num-bg: color-mix(in srgb, var(--error) 18%, var(--surface-container-low));
    --diff-ctx-fg: var(--on-surface);
    --diff-num-fg: color-mix(in srgb, var(--on-surface-variant) 60%, transparent);
    --diff-empty-bg: color-mix(in srgb, var(--surface-container-low) 60%, transparent);

    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    container-type: inline-size;
  }

  /* ============ Toolbar ============ */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    background: var(--surface-container-low);
    border-bottom: 1px solid var(--outline-variant);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--on-surface-variant);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .icon-btn:hover { background: var(--surface-container-high); color: var(--on-surface); }
  .icon-btn:disabled { cursor: default; opacity: 0.6; }
  .icon-btn.active { color: var(--on-surface); border-color: var(--outline-variant); }
  .icon-btn :global(.material-symbols-outlined) { font-size: 1rem; }
  .icon-btn :global(.material-symbols-outlined.spinning) { animation: diff-spin 0.8s linear infinite; }
  @keyframes diff-spin {
    to { transform: rotate(360deg); }
  }

  .mode-group {
    display: inline-flex;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    overflow: hidden;
  }
  .mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .mode-btn :global(.material-symbols-outlined) { font-size: 0.85rem; }
  .mode-btn:hover { background: var(--surface-container-highest); color: var(--on-surface); }
  .mode-btn.active { background: var(--surface-container-highest); color: var(--on-surface); font-weight: 600; }

  .copy-all-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: color-mix(in srgb, var(--secondary) 18%, var(--surface-container-high));
    border: 1px solid color-mix(in srgb, var(--secondary) 40%, var(--outline-variant));
    border-radius: 6px;
    color: var(--secondary);
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .copy-all-btn :global(.material-symbols-outlined) { font-size: 0.85rem; }
  .copy-all-btn:hover { background: color-mix(in srgb, var(--secondary) 28%, var(--surface-container-high)); }
  .copy-all-btn.copied { color: var(--on-surface); border-color: var(--secondary); }

  .viewed-counter {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--on-surface-variant);
  }
  .viewed-num { color: var(--secondary); font-weight: 600; }
  .viewed-sep { opacity: 0.5; }
  .viewed-total { color: var(--on-surface); }
  .viewed-label { margin-left: 4px; opacity: 0.7; }

  /* Local / Remote pills (preserved) */
  .diff-toggle-bar {
    display: flex;
    gap: 2px;
    padding: 6px 10px;
    background: var(--surface-container-low);
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
  }
  .diff-toggle-pill {
    padding: 3px 10px;
    border: none;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    color: var(--on-surface-variant);
  }
  .diff-toggle-pill:hover { background: var(--surface-container-high); color: var(--on-surface); }
  .diff-toggle-pill.active { background: var(--surface-container-highest); color: var(--on-surface); font-weight: 600; }

  /* ============ Body grid: file tree + stream ============ */
  .body {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  /* ============ Diff stream ============ */
  .diff-stream {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .project-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .project-banner {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .project-name {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--on-surface);
  }
  .project-stats {
    display: inline-flex;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--on-surface-variant);
  }
  .project-stats .stat.added { color: var(--secondary); }
  .project-stats .stat.removed { color: var(--error); }
</style>
