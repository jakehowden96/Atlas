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
    class="file-card-head"
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
    <div class="head-left">
      <span class="material-symbols-outlined chevron" class:rotated={!userCollapsed}>
        chevron_right
      </span>
      <span class="status-dot status-{item.file.changeType}" title={item.file.changeType}>
        {statusLetter(item.file.changeType)}
      </span>
      <span class="file-path" title={item.key}>{item.key}</span>
      <span class="line-stats">
        <span class="add-count">+{item.addedCount}</span>
        <span class="rem-count">-{item.removedCount}</span>
      </span>
    </div>
    <div class="head-right">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <label class="viewed-toggle" onclick={(e: MouseEvent) => e.stopPropagation()}>
        <input type="checkbox" checked={viewed} onchange={() => onToggleViewed(item.key)} />
        <span>Viewed</span>
      </label>
    </div>
  </header>

  {#if collapsed}
    <div class="collapsed-notice">
      <button class="expand-btn" onclick={() => onToggleExpand(item.key)}>
        Show {totalLines(item.file)} lines
      </button>
    </div>
  {:else if !viewed}
    {#if diffMode === "split"}
      <div class="diff-lines split">
        {#each toSplitRows(item.file) as row, ri (ri)}
          {#if row.kind === "hunk"}
            <div class="row hunk-row">
              <div class="hunk-cell">{row.header}</div>
            </div>
          {:else if row.kind === "context"}
            {@const ctxAnchor = buildAnchor(item.key, row.hunk, " ", row.left.num, row.right.num, row.right.content)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="row ctx-row commentable" onclick={() => onOpenComposer(ctxAnchor)}>
              <div class="num">{row.left.num ?? ""}</div>
              <div class="code">{row.left.content}</div>
              <div class="num">{row.right.num ?? ""}</div>
              <div class="code">{row.right.content}</div>
            </div>
            {@render commentThread(ctxAnchor)}
          {:else}
            {@const side = row.right ? "+" : "-"}
            {@const oldNum = row.left?.num ?? null}
            {@const newNum = row.right?.num ?? null}
            {@const content = row.right?.content ?? row.left?.content ?? ""}
            {@const chgAnchor = buildAnchor(item.key, row.hunk, side, oldNum, newNum, content)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="row chg-row commentable" onclick={() => onOpenComposer(chgAnchor)}>
              {#if row.left}
                <div class="num num-rem">{row.left.num ?? ""}</div>
                <div class="code code-rem"><span class="sign">-</span>{row.left.content}</div>
              {:else}
                <div class="num empty-num"></div>
                <div class="code empty-code"></div>
              {/if}
              {#if row.right}
                <div class="num num-add">{row.right.num ?? ""}</div>
                <div class="code code-add"><span class="sign">+</span>{row.right.content}</div>
              {:else}
                <div class="num empty-num"></div>
                <div class="code empty-code"></div>
              {/if}
            </div>
            {@render commentThread(chgAnchor)}
          {/if}
        {/each}
      </div>
    {:else}
      <div class="diff-lines unified">
        {#each item.file.hunks as hunk, hi (hi)}
          {#each hunk.lines as line, li (li)}
            {#if line.type === "hunk-header"}
              <div class="row hunk-row">
                <div class="hunk-cell">{hunk.header}</div>
              </div>
            {:else if line.type === "add"}
              {@const anchor = buildAnchor(item.key, hunk, "+", line.oldNum, line.newNum, line.content)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div class="row add-row commentable" onclick={() => onOpenComposer(anchor)}>
                <div class="num"></div>
                <div class="num num-add">{line.newNum ?? ""}</div>
                <div class="code code-add"><span class="sign">+</span>{line.content}</div>
              </div>
              {@render commentThread(anchor)}
            {:else if line.type === "remove"}
              {@const anchor = buildAnchor(item.key, hunk, "-", line.oldNum, line.newNum, line.content)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div class="row rem-row commentable" onclick={() => onOpenComposer(anchor)}>
                <div class="num num-rem">{line.oldNum ?? ""}</div>
                <div class="num"></div>
                <div class="code code-rem"><span class="sign">-</span>{line.content}</div>
              </div>
              {@render commentThread(anchor)}
            {:else}
              {@const anchor = buildAnchor(item.key, hunk, " ", line.oldNum, line.newNum, line.content)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div class="row ctx-row-uni commentable" onclick={() => onOpenComposer(anchor)}>
                <div class="num">{line.oldNum ?? ""}</div>
                <div class="num">{line.newNum ?? ""}</div>
                <div class="code">{line.content}</div>
              </div>
              {@render commentThread(anchor)}
            {/if}
          {/each}
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .file-card {
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    background: var(--surface-container-low);
    overflow: hidden;
    flex-shrink: 0;
  }
  .file-card.viewed { opacity: 0.6; }

  .file-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: var(--surface-container-high);
    border-bottom: 1px solid var(--outline-variant);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  .file-card-head:hover {
    background: var(--surface-container-highest);
  }
  .file-card-head:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .head-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .chevron {
    font-size: 1rem !important;
    color: var(--on-surface-variant);
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .chevron.rotated {
    transform: rotate(90deg);
  }

  .file-path {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--on-surface);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .line-stats {
    display: inline-flex;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    flex-shrink: 0;
  }
  .add-count { color: var(--secondary); }
  .rem-count { color: var(--error); }

  .status-dot {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-weight: 700;
    border-radius: 3px;
    width: 18px;
    height: 18px;
    font-size: 10px;
  }
  .status-modified { background: color-mix(in srgb, var(--primary) 18%, transparent); color: var(--primary); }
  .status-added { background: color-mix(in srgb, var(--secondary) 18%, transparent); color: var(--secondary); }
  .status-deleted { background: color-mix(in srgb, var(--error) 18%, transparent); color: var(--error); }
  .status-renamed { background: color-mix(in srgb, var(--tertiary) 18%, transparent); color: var(--tertiary); }

  .viewed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    background: var(--surface-container-low);
  }
  .viewed-toggle input { width: 12px; height: 12px; accent-color: var(--secondary); margin: 0; cursor: pointer; }
  .file-card.viewed .viewed-toggle {
    background: color-mix(in srgb, var(--secondary) 18%, transparent);
    border-color: color-mix(in srgb, var(--secondary) 45%, var(--outline-variant));
    color: var(--secondary);
  }

  /* ============ Diff lines ============ */
  .diff-lines {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
    overflow-x: auto;
    background: var(--surface);
    contain: content;
  }

  .row {
    display: grid;
    align-items: stretch;
  }
  .diff-lines.unified .row {
    grid-template-columns: 40px 40px 1fr;
  }
  .diff-lines.split .row {
    grid-template-columns: 36px 1fr 36px 1fr;
  }
  .diff-lines.split .hunk-row,
  .diff-lines.unified .hunk-row {
    grid-template-columns: 1fr;
  }

  .num {
    text-align: right;
    padding: 0 6px;
    color: var(--diff-num-fg);
    user-select: none;
    font-size: 11px;
    background: var(--surface-container-low);
    border-right: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    white-space: nowrap;
  }
  .code {
    padding: 0 12px;
    white-space: pre;
    color: var(--diff-ctx-fg);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sign {
    display: inline-block;
    width: 12px;
    margin-right: 4px;
    opacity: 0.7;
  }

  /* Hunk header */
  .hunk-row { background: color-mix(in srgb, var(--primary) 8%, var(--surface-container-low)); }
  .hunk-cell {
    padding: 2px 12px;
    color: var(--primary);
    font-size: 11px;
    opacity: 0.85;
    border-top: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
  }

  /* Add / remove rows */
  .add-row .code, .add-row .num-add { background: var(--diff-add-bg); }
  .add-row .num-add { color: var(--secondary); background: var(--diff-add-num-bg); }
  .add-row .code-add { color: var(--diff-add-fg); }

  .rem-row .code, .rem-row .num-rem { background: var(--diff-rem-bg); }
  .rem-row .num-rem { color: var(--error); background: var(--diff-rem-num-bg); }
  .rem-row .code-rem { color: var(--diff-rem-fg); }

  /* Split rows */
  .chg-row .code-add { background: var(--diff-add-bg); color: var(--diff-add-fg); }
  .chg-row .code-rem { background: var(--diff-rem-bg); color: var(--diff-rem-fg); }
  .chg-row .num-add { background: var(--diff-add-num-bg); color: var(--secondary); }
  .chg-row .num-rem { background: var(--diff-rem-num-bg); color: var(--error); }
  .empty-num, .empty-code { background: var(--diff-empty-bg); }

  /* Context row variants */
  .ctx-row .code, .ctx-row-uni .code { color: color-mix(in srgb, var(--on-surface) 80%, transparent); }

  /* Collapsed */
  .collapsed-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: var(--surface);
  }
  .expand-btn {
    padding: 4px 12px;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .expand-btn:hover { background: var(--surface-bright); color: var(--on-surface); }

  /* Review comments */
  .row.commentable { cursor: pointer; }
  .row.commentable:hover .num {
    background: color-mix(in srgb, var(--primary) 14%, var(--surface-container-low));
  }
</style>
