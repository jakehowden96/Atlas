<script lang="ts">
  import { get } from "svelte/store";
  import { toggled } from "../../sets";
  import { parseDiff, type DiffFile } from "../../diff-parser";
  import {
    cssEscape,
    dedupeKeys,
    overBudgetKeys,
    toFlat,
    TOTAL_LINE_BUDGET,
    type FlatFile,
  } from "../../diff-view";
  import { emptyDiffMessage, truncationNotice, type BaseView } from "../../diff-truncation";
  import { refreshPanel } from "../../ipc";
  import { log } from "../../logger";
  import { enterLabel, isMacPlatform } from "../../platform";
  import { submitReview } from "../../review/submitReview";
  import { panelData } from "../../stores/panel";
  import {
    activeSessionComments,
    addComment,
    anchorDomKey,
    clearForSession,
    removeComment,
    type ReviewAnchor,
    type ReviewComment,
  } from "../../stores/reviewComments";
  import { activeTabId, tabs } from "../../stores/terminal";
  import { diffOpen } from "../../stores/view";
  import { closeWith } from "../ui/Modal.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import DiffFileCard from "./DiffFileCard.svelte";
  import DiffFileTree from "./DiffFileTree.svelte";
  import { errorMessage } from "../../ipc-error";

  interface Props {
    /** Bound to `diffOpen`. The drawer unmounts itself once the exit run ends. */
    open: boolean;
  }

  let { open }: Props = $props();

  const EXIT_MS = 220;

  // Same delayed-unmount shape as Modal and the activity rail: `visible` lags
  // `open` so the slide-out keyframes finish before the node leaves the DOM.
  let visible = $state(false);
  let closing = $state(false);
  /** The pending unmount. A reopen inside the exit window must cancel it, or it
   *  would fire later and hide a panel that is meant to be open. */
  let exitTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (open) {
      clearTimeout(exitTimer);
      visible = true;
      closing = false;
    } else if (visible && !closing) {
      closing = true;
      exitTimer = closeWith(() => {
        visible = false;
        closing = false;
      }, EXIT_MS);
    }
  });

  // ── Session identity ──────────────────────────────────────────────────────
  // Panel data, review comments and `panel-update` are all keyed by the
  // *terminal tab id*, never the Claude session uuid. SessionView pins
  // `activeTabId` to the focused session's tab, so reading it here keeps the
  // diff, the comments and the PTY we submit into on the same session.
  let sessionId = $derived($activeTabId);
  let cwd = $derived($tabs.find((t) => t.id === sessionId)?.cwd ?? $panelData?.cwd ?? "");

  // Pull a fresh diff whenever the drawer opens onto a session, so switching
  // sessions never leaves the previous one's `panelData` on screen.
  let lastRefreshedFor = "";
  $effect(() => {
    const id = $activeTabId;
    if (!open) {
      lastRefreshedFor = "";
      return;
    }
    if (!id || id === lastRefreshedFor) return;
    lastRefreshedFor = id;
    const dir = get(tabs).find((t) => t.id === id)?.cwd ?? get(panelData)?.cwd ?? "";
    if (!dir) return;
    void refreshPanel(id, dir)
      .then((fresh) => {
        if (fresh && get(activeTabId) === id) panelData.set(fresh);
      })
      .catch((e) => {
        // A background refresh should not toast, but it should leave a trace.
        log.warn("changes", `panel refresh failed for tab=${id}: ${errorMessage(e)}`);
      });
  });

  // ── Working tree / vs main ────────────────────────────────────────────────
  // The backend's `discover_diff` already ships both sides: `local_raw` is the
  // working tree against HEAD, `raw` is the working tree against the branch
  // base (upstream merge-base, else merge-base with main/master). It only fills
  // `local_raw` in when the two differ, so with nothing committed on top of the
  // base both segments resolve to the same diff — which is the truth.
  const BASE_OPTIONS: Segment<BaseView>[] = [
    { id: "working", label: "Working tree" },
    { id: "main", label: "vs main" },
  ];
  const MODE_OPTIONS: Segment<"split" | "unified">[] = [
    { id: "unified", label: "Unified" },
    { id: "split", label: "Split" },
  ];

  let base = $state<BaseView>("working");
  let data = $derived($panelData?.diff);
  let hasSeparateBase = $derived(!!data?.local_raw && data.local_raw !== data.raw);
  let activeRaw = $derived(hasSeparateBase && base === "working" ? data!.local_raw! : data?.raw);
  let baseHint = $derived(
    hasSeparateBase
      ? "Working tree = uncommitted changes. vs main = everything since this branch left its base."
      : "Nothing is committed on top of this branch's base, so both views show the same diff.",
  );

  // ── Parsing (memoised, exactly as the old DiffViewer did) ─────────────────
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
  let lastProjectFiles: {
    name: string;
    files_changed: number;
    lines_added: number;
    lines_removed: number;
    files: DiffFile[];
  }[] = [];
  let projectFiles = $derived.by(() => {
    const projects = data?.projects;
    if (!projects) return [];
    // The backend's fingerprint stands for every project's text, so the
    // memo needs no copy of them to compare against.
    const key = data?.fingerprint ?? "";
    if (key === lastProjectsKey) return lastProjectFiles;
    lastProjectsKey = key;
    lastProjectFiles = projects.map((p) => ({ ...p, files: parseDiff(p.raw) }));
    return lastProjectFiles;
  });

  let isMultiRepo = $derived(projectFiles.length > 0);

  type ProjectFlat = { name: string; items: FlatFile[] };
  let projectFlat = $derived<ProjectFlat[]>(
    isMultiRepo
      ? projectFiles.map((p) => ({
          name: p.name,
          items: dedupeKeys(p.files.map((f) => toFlat(f, `${p.name}/${f.newName}`))),
        }))
      : [],
  );
  let flatFiles = $derived<FlatFile[]>(
    isMultiRepo
      ? projectFlat.flatMap((pf) => pf.items)
      : dedupeKeys(files.map((f) => toFlat(f, f.newName))),
  );

  let truncation = $derived(truncationNotice(data, base));

  // Header counts come from what is actually rendered, so they stay honest
  // across the Working tree / vs main toggle.
  let addedTotal = $derived(flatFiles.reduce((n, f) => n + f.addedCount, 0));
  let removedTotal = $derived(flatFiles.reduce((n, f) => n + f.removedCount, 0));

  // Files past the drawer's line budget start collapsed, like an oversized one.
  let overBudget = $derived(overBudgetKeys(flatFiles, TOTAL_LINE_BUDGET));

  // ── Viewed / collapse state ───────────────────────────────────────────────
  // Both belong to one diff of one checkout, so both reset when either
  // changes. The previous key concatenated `cwd` and the whole diff text on
  // every panel update just to compare it; comparing the two values directly
  // allocates nothing.
  let viewedFiles: Set<string> = $state(new Set());
  let resetCwd = "";
  let resetFingerprint = "";

  $effect(() => {
    const fingerprint = data?.fingerprint ?? "";
    if (cwd !== resetCwd || fingerprint !== resetFingerprint) {
      resetCwd = cwd;
      resetFingerprint = fingerprint;
      viewedFiles = new Set();
      userCollapsed = new Set();
      expandedFiles = new Set();
    }
  });

  function toggleViewed(key: string) {
    viewedFiles = toggled(viewedFiles, key);
  }

  let viewedCount = $derived(flatFiles.filter((f) => viewedFiles.has(f.key)).length);

  // ── Per-file collapse ─────────────────────────────────────────────────────
  // userCollapsed: the user clicked the header to hide a file
  // expandedFiles: the user clicked "Show N lines" past the size auto-collapse
  let diffMode = $state<"split" | "unified">("unified");
  let userCollapsed: Set<string> = $state(new Set());
  let expandedFiles: Set<string> = $state(new Set());

  function toggleUserCollapsed(key: string) {
    userCollapsed = toggled(userCollapsed, key);
  }

  function toggleExpand(key: string) {
    expandedFiles = toggled(expandedFiles, key);
  }

  function scrollToFile(key: string) {
    document
      .getElementById("diff-file-" + cssEscape(key))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Review comments ───────────────────────────────────────────────────────
  // composerKey identifies the line whose inline composer is open; null when
  // none is showing. It matches anchorDomKey() so lookups stay cheap.
  let composerKey = $state<string | null>(null);

  let commentsByAnchorKey = $derived.by(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of $activeSessionComments) {
      const k = anchorDomKey(c.anchor);
      const list = m.get(k) ?? [];
      list.push(c);
      m.set(k, list);
    }
    return m;
  });

  function saveComment(anchor: ReviewAnchor, body: string) {
    if (!sessionId) return;
    addComment(sessionId, anchor, body);
    composerKey = null;
  }

  function dismissComment(id: string) {
    if (!sessionId) return;
    removeComment(sessionId, id);
  }

  let submitting = $state(false);
  let commentCount = $derived($activeSessionComments.length);

  async function send() {
    if (submitting || !sessionId) return;
    submitting = true;
    try {
      await submitReview(sessionId);
    } finally {
      submitting = false;
    }
  }
</script>

{#if visible}
  <aside class="drawer" class:closing aria-label="Changes">
    <header class="head">
      <span class="title">Changes</span>
      <span class="counts">
        {flatFiles.length} file{flatFiles.length === 1 ? "" : "s"} ·
        <span class="added">+{addedTotal}</span>
        <span class="removed">−{removedTotal}</span>
      </span>
      <span class="seg" title={baseHint}>
        <SegmentedControl
          size="sm"
          options={BASE_OPTIONS}
          value={base}
          onChange={(id) => (base = id)}
        />
      </span>

      <div class="spacer"></div>

      <SegmentedControl
        size="sm"
        options={MODE_OPTIONS}
        value={diffMode}
        onChange={(id) => (diffMode = id as "split" | "unified")}
      />
      <span class="viewed">{viewedCount}/{flatFiles.length} viewed</span>
      <button
        type="button"
        class="close"
        aria-label="Close changes"
        onclick={() => diffOpen.set(false)}>✕</button
      >
    </header>

    {#if truncation}
      <div class="notice" role="status">{truncation}</div>
    {/if}

    <div class="body">
      {#if flatFiles.length === 0}
        <div class="clean">{emptyDiffMessage($panelData, isMacPlatform())}</div>
      {:else}
        <DiffFileTree
          {flatFiles}
          {viewedFiles}
          onSelectFile={scrollToFile}
          onToggleViewed={toggleViewed}
        />

        <div class="stream">
          {#if isMultiRepo}
            {#each projectFlat as pf (pf.name)}
              <div class="repo">{pf.name}</div>
              {#each pf.items as item (item.key)}
                {@render fileCard(item)}
              {/each}
            {/each}
          {:else}
            {#each flatFiles as item (item.key)}
              {@render fileCard(item)}
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <footer class="foot">
      <span class="foot-text">
        {#if commentCount > 0}
          {commentCount} review comment{commentCount === 1 ? "" : "s"} · sent as one prompt
        {:else}
          No review comments · pick a diff line and press {enterLabel()} to leave one
        {/if}
      </span>
      <div class="spacer"></div>
      <button
        type="button"
        class="discard"
        disabled={commentCount === 0}
        onclick={() => sessionId && clearForSession(sessionId)}>Discard</button
      >
      <button type="button" class="send" disabled={commentCount === 0 || submitting} onclick={send}
        >{submitting ? "Sending…" : "Send to Claude"}</button
      >
    </footer>
  </aside>
{/if}

{#snippet fileCard(item: FlatFile)}
  <DiffFileCard
    {item}
    {diffMode}
    viewed={viewedFiles.has(item.key)}
    userCollapsed={userCollapsed.has(item.key)}
    expanded={expandedFiles.has(item.key)}
    overBudget={overBudget.has(item.key)}
    {commentsByAnchorKey}
    {composerKey}
    onToggleViewed={toggleViewed}
    onToggleCollapsed={toggleUserCollapsed}
    onToggleExpand={toggleExpand}
    onOpenComposer={(anchor) => (composerKey = anchorDomKey(anchor))}
    onCloseComposer={() => (composerKey = null)}
    onSaveComment={saveComment}
    onDismissComment={dismissComment}
  />
{/snippet}

<style>
  .drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    /* Reviewing a diff and watching the session are separate activities, so the
       drawer takes most of the viewport rather than sharing it with the pane. */
    width: min(1080px, 92%);
    /* The drawer itself never scrolls sideways — only `.lines` inside a file
       card does. */
    overflow: hidden;
    border-left: 1px solid var(--border2);
    background: var(--surface);
    box-shadow: var(--shadow);
    animation: atlasSlideLeft 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .drawer.closing {
    animation: atlasSlideRight 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  /* ── Header ────────────────────────────────────────────────────────────── */
  .head {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    height: 44px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    flex-shrink: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .counts {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .added {
    color: var(--accent);
  }

  .removed {
    color: var(--danger);
  }

  .seg {
    display: flex;
    min-width: 0;
  }

  .spacer {
    flex: 1;
  }

  .viewed {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .close {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface2);
    color: var(--text);
  }

  /* ── Body ──────────────────────────────────────────────────────────────── */
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .stream {
    flex: 1;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .repo {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .notice {
    flex-shrink: 0;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .clean {
    display: grid;
    flex: 1;
    place-items: center;
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  /* ── Footer ────────────────────────────────────────────────────────────── */
  .foot {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }

  .foot-text {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .discard,
  .send {
    flex-shrink: 0;
    height: 26px;
    border-radius: var(--r-md);
    font-family: var(--font-ui);
    cursor: pointer;
  }

  .discard {
    padding: 0 10px;
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .discard:hover:not(:disabled) {
    background: var(--surface2);
  }

  .send {
    padding: 0 12px;
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .discard:disabled,
  .send:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
