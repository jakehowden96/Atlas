<script lang="ts">
  import type { DiffHunk } from "../../diff-parser";
  import {
    cssEscape,
    statusLetter,
    totalLines,
    toSplitRows,
    type FlatFile,
  } from "../../diff-view";
  import {
    anchorDomKey,
    type ReviewAnchor,
    type ReviewComment,
  } from "../../stores/reviewComments";
  import DiffCommentThread from "./DiffCommentThread.svelte";

  interface Props {
    item: FlatFile;
    diffMode: "split" | "unified";
    viewed: boolean;
    userCollapsed: boolean;
    expanded: boolean;
    commentsByAnchorKey: Map<string, ReviewComment[]>;
    composerKey: string | null;
    onToggleViewed: (key: string) => void;
    onToggleCollapsed: (key: string) => void;
    onToggleExpand: (key: string) => void;
    onOpenComposer: (anchor: ReviewAnchor) => void;
    onCloseComposer: () => void;
    onSaveComment: (anchor: ReviewAnchor, body: string) => void;
    onDismissComment: (id: string) => void;
  }

  let {
    item,
    diffMode,
    viewed,
    userCollapsed,
    expanded,
    commentsByAnchorKey,
    composerKey,
    onToggleViewed,
    onToggleCollapsed,
    onToggleExpand,
    onOpenComposer,
    onCloseComposer,
    onSaveComment,
    onDismissComment,
  }: Props = $props();

  // userCollapsed: the user clicked the header to hide the file
  // expanded: the user clicked "Show N lines" to override the size-based auto-collapse
  const MAX_VISIBLE_LINES = 500;
  let collapsed = $derived(
    userCollapsed || (totalLines(item.file) > MAX_VISIBLE_LINES && !expanded),
  );

  let splitRows = $derived(toSplitRows(item.file));

  /* One tab stop per card, and ↑/↓ move it — the same roving shape the Sessions
     grid uses. A tab stop per diff line would put hundreds of them between the
     drawer's header and its Send button; none at all is what left "click a diff
     line to leave one" the only way to open a review composer. Ids are minted
     per render mode, so `tabRow` falls back rather than trusting a stale one. */
  let rowsEl: HTMLDivElement | undefined = $state();
  let cursor = $state("");

  let rowIds = $derived.by(() => {
    if (diffMode === "split") {
      return splitRows.flatMap((row, i) => (row.kind === "hunk" ? [] : [`s${i}`]));
    }
    return item.file.hunks.flatMap((hunk, hi) =>
      hunk.lines.flatMap((line, li) => (line.type === "hunk-header" ? [] : [`u${hi}-${li}`])),
    );
  });

  let tabRow = $derived(rowIds.includes(cursor) ? cursor : (rowIds[0] ?? ""));

  function commentRows(): HTMLElement[] {
    return [...(rowsEl?.querySelectorAll<HTMLElement>(".row.commentable") ?? [])];
  }

  function onRowsKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = commentRows();
    // -1 when the composer's own textarea has focus; its arrows stay its own.
    const at = rows.findIndex((el) => el.contains(e.target as Node));
    const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
    if (at < 0 || !next) return;
    e.preventDefault();
    cursor = next.dataset.rowId ?? "";
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
  }

  /** Keeps the cursor honest however focus arrived — click, ⇥ or an arrow. */
  function onRowsFocusIn(e: FocusEvent) {
    const el = (e.target as HTMLElement | null)?.closest?.(".row.commentable");
    if (el instanceof HTMLElement && el.dataset.rowId) cursor = el.dataset.rowId;
  }

  function rowActivate(e: KeyboardEvent, anchor: ReviewAnchor) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onOpenComposer(anchor);
  }

  function buildAnchor(
    fileKey: string,
    hunk: DiffHunk,
    side: "+" | "-" | " ",
    oldNum: number | null,
    newNum: number | null,
    content: string,
  ): ReviewAnchor {
    return {
      fileKey,
      side,
      oldNum,
      newNum,
      hunkHeader: hunk.header,
      contentSnippet: content,
    };
  }
</script>

{#snippet commentThread(anchor: ReviewAnchor)}
  {@const key = anchorDomKey(anchor)}
  {@const list = commentsByAnchorKey.get(key) ?? []}
  {#if list.length > 0 || composerKey === key}
    <DiffCommentThread
      {anchor}
      comments={list}
      composerOpen={composerKey === key}
      onClose={onCloseComposer}
      onSave={onSaveComment}
      onDismiss={onDismissComment}
    />
  {/if}
{/snippet}

<section
  class="file-card"
  class:viewed
  id={"diff-file-" + cssEscape(item.key)}
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <header
    class="head"
    role="button"
    tabindex="0"
    onclick={() => onToggleCollapsed(item.key)}
    onkeydown={(e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleCollapsed(item.key);
      }
    }}
  >
    <span class="chev" class:open={!userCollapsed}>›</span>
    <span class="status status-{item.file.changeType}" title={item.file.changeType}>
      {statusLetter(item.file.changeType)}
    </span>
    <span class="path" title={item.key}>{item.key}</span>
    <span class="added">+{item.addedCount}</span>
    <span class="removed">−{item.removedCount}</span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <label class="viewed-toggle" onclick={(e: MouseEvent) => e.stopPropagation()}>
      <input type="checkbox" checked={viewed} onchange={() => onToggleViewed(item.key)} />
      <span>Viewed</span>
    </label>
  </header>

  {#if collapsed}
    <div class="collapsed-notice">
      <button type="button" class="expand-btn" onclick={() => onToggleExpand(item.key)}>
        Show {totalLines(item.file)} lines
      </button>
    </div>
  {:else if !viewed}
    <!-- `.lines` is the only horizontal scroller in the drawer; `.rows` widens
         to the longest code line so row tints span the full scroll width. -->
    <div class="lines">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={rowsEl}
        class="rows"
        class:split={diffMode === "split"}
        onkeydown={onRowsKeydown}
        onfocusin={onRowsFocusIn}
      >
        {#if diffMode === "split"}
          {#each splitRows as row, ri (ri)}
            {#if row.kind === "hunk"}
              <div class="row hunk"><span class="hunk-text">{row.header}</span></div>
            {:else if row.kind === "context"}
              {@const ctxAnchor = buildAnchor(item.key, row.hunk, " ", row.left.num, row.right.num, row.right.content)}
              <div
                class="row commentable"
                role="button"
                tabindex={`s${ri}` === tabRow ? 0 : -1}
                data-row-id={`s${ri}`}
                onclick={() => onOpenComposer(ctxAnchor)}
                onkeydown={(e: KeyboardEvent) => rowActivate(e, ctxAnchor)}
              >
                <span class="num">{row.left.num ?? ""}</span>
                <span class="code">{row.left.content}</span>
                <span class="num">{row.right.num ?? ""}</span>
                <span class="code">{row.right.content}</span>
              </div>
              {@render commentThread(ctxAnchor)}
            {:else}
              {@const side = row.right ? "+" : "-"}
              {@const oldNum = row.left?.num ?? null}
              {@const newNum = row.right?.num ?? null}
              {@const content = row.right?.content ?? row.left?.content ?? ""}
              {@const chgAnchor = buildAnchor(item.key, row.hunk, side, oldNum, newNum, content)}
              <div
                class="row commentable"
                role="button"
                tabindex={`s${ri}` === tabRow ? 0 : -1}
                data-row-id={`s${ri}`}
                onclick={() => onOpenComposer(chgAnchor)}
                onkeydown={(e: KeyboardEvent) => rowActivate(e, chgAnchor)}
              >
                {#if row.left}
                  <span class="num del">{row.left.num ?? ""}</span>
                  <span class="code del">−{row.left.content}</span>
                {:else}
                  <span class="num"></span>
                  <span class="code"></span>
                {/if}
                {#if row.right}
                  <span class="num ins">{row.right.num ?? ""}</span>
                  <span class="code ins">+{row.right.content}</span>
                {:else}
                  <span class="num"></span>
                  <span class="code"></span>
                {/if}
              </div>
              {@render commentThread(chgAnchor)}
            {/if}
          {/each}
        {:else}
          {#each item.file.hunks as hunk, hi (hi)}
            {#each hunk.lines as line, li (li)}
              {#if line.type === "hunk-header"}
                <div class="row hunk"><span class="hunk-text">{hunk.header}</span></div>
              {:else if line.type === "add"}
                {@const anchor = buildAnchor(item.key, hunk, "+", line.oldNum, line.newNum, line.content)}
                <div
                  class="row ins commentable"
                  role="button"
                  tabindex={`u${hi}-${li}` === tabRow ? 0 : -1}
                  data-row-id={`u${hi}-${li}`}
                  onclick={() => onOpenComposer(anchor)}
                  onkeydown={(e: KeyboardEvent) => rowActivate(e, anchor)}
                >
                  <span class="num"></span>
                  <span class="num">{line.newNum ?? ""}</span>
                  <span class="code">+{line.content}</span>
                </div>
                {@render commentThread(anchor)}
              {:else if line.type === "remove"}
                {@const anchor = buildAnchor(item.key, hunk, "-", line.oldNum, line.newNum, line.content)}
                <div
                  class="row del commentable"
                  role="button"
                  tabindex={`u${hi}-${li}` === tabRow ? 0 : -1}
                  data-row-id={`u${hi}-${li}`}
                  onclick={() => onOpenComposer(anchor)}
                  onkeydown={(e: KeyboardEvent) => rowActivate(e, anchor)}
                >
                  <span class="num">{line.oldNum ?? ""}</span>
                  <span class="num"></span>
                  <span class="code">−{line.content}</span>
                </div>
                {@render commentThread(anchor)}
              {:else}
                {@const anchor = buildAnchor(item.key, hunk, " ", line.oldNum, line.newNum, line.content)}
                <div
                  class="row commentable"
                  role="button"
                  tabindex={`u${hi}-${li}` === tabRow ? 0 : -1}
                  data-row-id={`u${hi}-${li}`}
                  onclick={() => onOpenComposer(anchor)}
                  onkeydown={(e: KeyboardEvent) => rowActivate(e, anchor)}
                >
                  <span class="num">{line.oldNum ?? ""}</span>
                  <span class="num">{line.newNum ?? ""}</span>
                  <span class="code">{line.content}</span>
                </div>
                {@render commentThread(anchor)}
              {/if}
            {/each}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .file-card {
    flex-shrink: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
  }

  .file-card.viewed {
    opacity: 0.55;
  }

  /* ── File header ───────────────────────────────────────────────────────── */
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: var(--surface);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }

  .head:hover {
    background: var(--surface2);
  }

  .head:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .chev {
    flex-shrink: 0;
    width: 10px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 12px;
    transition: transform 0.15s ease;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .status {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: var(--r-xs);
    background: var(--surface2);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 700;
  }

  .status-added {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--t-step);
  }

  .status-deleted {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }

  .status-renamed {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    color: var(--t-warn);
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .added,
  .removed {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .added {
    color: var(--accent);
  }

  .removed {
    color: var(--danger);
  }

  .viewed-toggle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    gap: 5px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 11px;
    cursor: pointer;
    user-select: none;
  }

  .viewed-toggle input {
    width: 11px;
    height: 11px;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .file-card.viewed .viewed-toggle {
    color: var(--accent);
  }

  /* ── Diff lines ────────────────────────────────────────────────────────── */
  .lines {
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--surface);
    font: 12px/1.7 var(--font-mono);
    contain: content;
  }

  /* Unified rows are as wide as the longest line so `.lines` scrolls sideways
     and the row tints span the whole scroll width. */
  .rows {
    min-width: 100%;
    width: max-content;
  }

  /* Split rows can't grow — the two sides have to stay paired — so they fill
     the column and clip instead. */
  .rows.split {
    width: 100%;
  }

  .row {
    display: flex;
    padding: 0 14px;
    color: var(--muted);
  }

  .rows.split .row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) 34px minmax(0, 1fr);
  }

  .rows.split .row.hunk {
    grid-template-columns: 1fr;
  }

  .num {
    flex-shrink: 0;
    width: 34px;
    color: var(--muted);
    user-select: none;
  }

  .code {
    white-space: pre;
  }

  .rows.split .code {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Additions / deletions — design tokens, tinted over whatever is behind. */
  .row.ins,
  .rows.split .code.ins,
  .rows.split .num.ins {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--t-step);
  }

  .row.del,
  .rows.split .code.del,
  .rows.split .num.del {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
  }

  .row.ins .num,
  .row.del .num {
    color: inherit;
    opacity: 0.7;
  }

  .row.hunk {
    padding-top: 2px;
    padding-bottom: 2px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }

  .hunk-text {
    color: var(--muted);
    font-size: 11px;
  }

  .row.commentable {
    cursor: pointer;
  }

  .row.commentable:hover .num {
    color: var(--text);
  }

  /* The cursor row. Inset because the row runs the full scroll width. */
  .row.commentable:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* ── Collapsed ─────────────────────────────────────────────────────────── */
  .collapsed-notice {
    display: grid;
    place-items: center;
    padding: 12px;
    background: var(--surface);
  }

  .expand-btn {
    height: 24px;
    padding: 0 12px;
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }

  .expand-btn:hover {
    background: var(--surface2);
    color: var(--text);
  }
</style>
