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
  import { truncationNotice } from "../../diff-truncation";
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
  import { showToast } from "../../stores/toast";
  import { diffOpen } from "../../stores/view";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import { confirmAction } from "../ui/ConfirmDialog.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import Drawer from "../ui/Drawer.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import DiffFileCard from "./DiffFileCard.svelte";
  import DiffFileTree from "./DiffFileTree.svelte";
  import { errorMessage } from "../../ipc-error";

  interface Props {
    /** Bound to `diffOpen`. The drawer unmounts itself once the exit run ends. */
    open: boolean;
  }

  let { open }: Props = $props();

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

  // `raw` is `git diff HEAD` plus untracked files: uncommitted work only, as
  // VS Code's Source Control panel shows it.
  const MODE_OPTIONS: Segment<"split" | "unified">[] = [
    { id: "unified", label: "Unified" },
    { id: "split", label: "Split" },
  ];

  let data = $derived($panelData?.diff);

  // ── Parsing (memoised, exactly as the old DiffViewer did) ─────────────────
  let lastRaw = "";
  let lastFiles: DiffFile[] = [];
  let files = $derived.by(() => {
    const raw = data?.raw ?? "";
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

  let truncation = $derived(truncationNotice(data));

  // Header counts come from what is actually rendered.
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

  /** Esc while the confirm is up must only dismiss the confirm. The window
   *  handler in shortcuts.ts would otherwise close this drawer behind it. */
  function swallowEscape(e: KeyboardEvent) {
    if (e.key === "Escape") e.stopPropagation();
  }

  async function discard() {
    const id = sessionId;
    const saved = $activeSessionComments;
    if (!id || saved.length === 0) return;
    const n = saved.length;
    const noun = `review comment${n === 1 ? "" : "s"}`;
    document.addEventListener("keydown", swallowEscape);
    let ok = false;
    try {
      ok = await confirmAction({
        title: `Discard ${n} ${noun}?`,
        body: "They will be removed from this session and cannot be recovered.",
        confirmLabel: "Discard",
        tone: "danger",
      });
    } finally {
      // After a turn, so the Esc that dismissed the confirm has finished bubbling.
      setTimeout(() => document.removeEventListener("keydown", swallowEscape));
    }
    if (!ok) return;
    clearForSession(id);
    showToast(`Discarded ${n} ${noun}`, {
      type: "info",
      action: {
        label: "Undo",
        run: () => {
          for (const c of saved) addComment(id, c.anchor, c.body);
        },
      },
    });
  }

  let installCommand = $derived(
    isMacPlatform() ? "xcode-select --install" : "winget install --id Git.Git",
  );
  let gitMissing = $derived($panelData?.issue === "git_not_found");

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

<!-- Esc is left to shortcuts.ts (composer first, then this drawer), so Modal's own
     Esc handling is switched off by marking the event handled before it sees it. -->
<Drawer
  {open}
  onClose={() => diffOpen.set(false)}
  labelledBy="changes-title"
  width="min(1080px, 92vw)"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="content" onkeydown={(e) => e.key === "Escape" && e.preventDefault()}>
    <header class="head">
      <h2 id="changes-title" class="title">Changes</h2>
      <span class="counts">
        {flatFiles.length} file{flatFiles.length === 1 ? "" : "s"} ·
        <span class="added">+{addedTotal}</span>
        <span class="removed">−{removedTotal}</span>
      </span>
      <div class="spacer"></div>

      <SegmentedControl
        size="sm"
        role="radiogroup"
        label="Diff layout"
        options={MODE_OPTIONS}
        value={diffMode}
        onChange={(id) => (diffMode = id)}
      />
      <span class="viewed">viewed {viewedCount}/{flatFiles.length}</span>
      <IconButton
        icon="close"
        size="sm"
        label="Close changes"
        onclick={() => diffOpen.set(false)}
      />
    </header>

    {#if truncation}
      <div class="notice"><Banner tone="info" title={truncation} /></div>
    {/if}

    <div class="body">
      {#if flatFiles.length === 0}
        <div class="clean">
          {#if gitMissing}
            <EmptyState
              icon="terminal"
              title="Git was not found"
              description="Install git, then reopen this panel"
            >
              {#snippet action()}
                <code class="cmd">{installCommand}</code>
                <CopyButton value={installCommand} variant="text" label="Copy install command" />
              {/snippet}
            </EmptyState>
          {:else}
            <EmptyState icon="check_circle" title="Working tree clean" />
          {/if}
        </div>
      {:else}
        <DiffFileTree
          {flatFiles}
          repos={projectFlat.map((pf) => pf.name)}
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
      <Button size="sm" disabled={commentCount === 0} onclick={discard}>Discard</Button>
      <Button size="sm" variant="primary" disabled={commentCount === 0 || submitting} onclick={send}
        >{submitting ? "Sending…" : "Send to Claude"}</Button
      >
    </footer>
  </div>
</Drawer>

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
  .content {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  /* ── Header ────────────────────────────────────────────────────────────── */
  .head {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    height: var(--h-bar);
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    flex-shrink: 0;
    margin: 0;
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
    z-index: var(--z-sticky);
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
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }

  .clean {
    display: grid;
    flex: 1;
    place-items: center;
  }

  .cmd {
    padding: 4px 8px;
    border-radius: var(--r-sm);
    background: var(--surface2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
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
</style>
