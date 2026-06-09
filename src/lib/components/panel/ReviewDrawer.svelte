<script lang="ts">
  import { get } from "svelte/store";
  import { writeTextFile } from "@tauri-apps/plugin-fs";
  import { activeTabId, tabs } from "../../stores/terminal";
  import {
    activeSessionComments,
    assignShortIdsForSubmit,
    clearForSession,
    removeComment,
    anchorDomKey,
  } from "../../stores/reviewComments";
  import { getSessionDir, ptyWrite } from "../../ipc";
  import { formatReviewPrompt } from "../../review/formatPrompt";
  import { showToast } from "../../stores/toast";

  let submitting = $state(false);

  function dismiss(id: string) {
    const sid = get(activeTabId);
    if (!sid) return;
    removeComment(sid, id);
  }

  function discardAll() {
    const sid = get(activeTabId);
    if (!sid) return;
    clearForSession(sid);
  }

  function scrollToAnchor(key: string) {
    const el = document.querySelector(`[data-anchor="${CSS.escape(key)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submit() {
    if (submitting) return;
    const sid = get(activeTabId);
    if (!sid) return;
    const tab = get(tabs).find((t) => t.id === sid);
    if (!tab || tab.type !== "terminal" || tab.ptyId < 0) {
      showToast("No active Claude terminal to send the review to.");
      return;
    }

    submitting = true;
    try {
      const stamped = assignShortIdsForSubmit(sid);
      if (stamped.length === 0) return;

      // Session dir = ~/.atlas/sessions/<sid>. The Rust command creates it
      // on demand. The watcher picks up appends to review-acks.txt and emits
      // 'review-ack', which the App.svelte listener feeds back to the store.
      const sessionDir = await getSessionDir(sid);
      const ackPath = `${sessionDir}/review-acks.txt`;

      // Truncate any prior contents so a stale id from a previous round
      // doesn't immediately mark a fresh comment as acked.
      await writeTextFile(ackPath, "");

      const prompt = formatReviewPrompt(stamped, ackPath);
      // Trailing CR submits Claude's input line. If Claude is mid-turn,
      // Claude Code's own terminal queues the line until it's ready.
      await ptyWrite(tab.ptyId, prompt + "\r");
      showToast(`Sent ${stamped.length} review comment${stamped.length === 1 ? "" : "s"} to Claude`, "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Failed to submit review: ${msg}`);
    } finally {
      submitting = false;
    }
  }
</script>

{#if $activeSessionComments.length > 0}
  <div class="review-drawer">
    <header class="drawer-head">
      <span class="drawer-title">
        <span class="material-symbols-outlined">rate_review</span>
        {$activeSessionComments.length} review {$activeSessionComments.length === 1 ? "comment" : "comments"}
      </span>
      <div class="drawer-actions">
        <button type="button" class="drawer-btn ghost" onclick={discardAll} title="Discard all comments">
          Discard
        </button>
        <button
          type="button"
          class="drawer-btn primary"
          onclick={submit}
          disabled={submitting}
          title="Send all comments to the active Claude session"
        >
          {submitting ? "Sending…" : "Submit review"}
        </button>
      </div>
    </header>
    <ul class="drawer-list">
      {#each $activeSessionComments as c (c.id)}
        {@const a = c.anchor}
        {@const lineNum = a.newNum ?? a.oldNum ?? 0}
        <li class="drawer-item">
          <button type="button" class="item-link" onclick={() => scrollToAnchor(anchorDomKey(a))}>
            <span class="item-path">{a.fileKey}<span class="item-line">:{lineNum}</span></span>
            <span class="item-body">{c.body}</span>
          </button>
          <button type="button" class="item-dismiss" onclick={() => dismiss(c.id)} aria-label="Dismiss">
            <span class="material-symbols-outlined">close</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .review-drawer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--primary) 8%, var(--surface-container-low));
    border-bottom: 1px solid color-mix(in srgb, var(--primary) 30%, var(--outline-variant));
    flex-shrink: 0;
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .drawer-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    color: var(--on-surface);
  }
  .drawer-title :global(.material-symbols-outlined) {
    font-size: 1rem;
    color: var(--primary);
  }

  .drawer-actions {
    display: inline-flex;
    gap: 6px;
  }

  .drawer-btn {
    padding: 3px 10px;
    border-radius: 6px;
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--outline-variant);
    background: var(--surface-container-high);
    color: var(--on-surface);
  }
  .drawer-btn.ghost {
    background: transparent;
    color: var(--on-surface-variant);
  }
  .drawer-btn.ghost:hover { color: var(--on-surface); background: var(--surface-container-high); }
  .drawer-btn.primary {
    background: var(--primary);
    color: var(--on-primary);
    border-color: var(--primary);
  }
  .drawer-btn.primary:disabled { opacity: 0.6; cursor: default; }
  .drawer-btn.primary:not(:disabled):hover {
    background: color-mix(in srgb, var(--primary) 88%, var(--on-surface));
  }

  .drawer-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
  }

  .drawer-item {
    display: flex;
    align-items: stretch;
    gap: 4px;
    background: var(--surface);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    overflow: hidden;
  }

  .item-link {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 5px 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--on-surface);
    min-width: 0;
  }
  .item-link:hover { background: var(--surface-container-low); }

  .item-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .item-line { color: var(--primary); }
  .item-body {
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--on-surface);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .item-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-left: 1px solid var(--outline-variant);
  }
  .item-dismiss :global(.material-symbols-outlined) { font-size: 1rem; }
  .item-dismiss:hover { background: var(--surface-container-high); color: var(--error); }
</style>
