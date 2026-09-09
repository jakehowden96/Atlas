<script lang="ts">
  import { chord } from "../../platform";
  import {
    anchorDomKey,
    type ReviewAnchor,
    type ReviewComment,
  } from "../../stores/reviewComments";

  interface Props {
    anchor: ReviewAnchor;
    comments: ReviewComment[];
    composerOpen: boolean;
    onClose: () => void;
    onSave: (anchor: ReviewAnchor, body: string) => void;
    onDismiss: (id: string) => void;
  }

  let { anchor, comments, composerOpen, onClose, onSave, onDismiss }: Props = $props();

  let body = $state("");

  let lineNum = $derived(anchor.newNum ?? anchor.oldNum ?? 0);

  function save() {
    const trimmed = body.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    onSave(anchor, trimmed);
  }

  function composerKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      // Esc cascades window-wide (shortcuts.ts closes the drawer next), so the
      // composer has to claim it or cancelling a comment would also close the
      // drawer around it.
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }
</script>

<div class="comment-row" data-anchor={anchorDomKey(anchor)}>
  {#each comments as c (c.id)}
    <div class="card">
      <div class="card-top">
        <span class="card-body">{c.body}</span>
        <button
          type="button"
          class="dismiss"
          title="Dismiss this comment"
          aria-label="Dismiss comment"
          onclick={() => onDismiss(c.id)}
        >✕</button>
      </div>
      <div class="caption">Review comment · line {lineNum} · pending</div>
    </div>
  {/each}

  {#if composerOpen}
    <div class="card composer">
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class="input"
        placeholder={`Leave a review comment… (${chord("Enter")} to save, Esc to cancel)`}
        bind:value={body}
        onkeydown={composerKeydown}
        autofocus
        rows="2"
      ></textarea>
      <div class="actions">
        <button type="button" class="btn cancel" onclick={onClose}>Cancel</button>
        <button type="button" class="btn save" onclick={save}>Save</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .comment-row {
    display: flex;
    flex-direction: column;
  }

  /* Design: the inline review card sits in the diff column, --bg on an accent
     hairline, with a muted caption underneath. */
  .card {
    margin: 6px 14px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: var(--r-md);
    background: var(--bg);
    font: var(--fs-sm)/1.4 var(--font-ui);
    color: var(--text);
  }

  .card-top {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .card-body {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .caption {
    margin-top: 6px;
    color: var(--muted);
    font: var(--fs-xs) var(--font-ui);
  }

  .dismiss {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  .dismiss:hover {
    background: var(--surface2);
    color: var(--danger);
  }

  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .input {
    width: 100%;
    min-height: 46px;
    padding: 6px 8px;
    border: 1px solid var(--border2);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text);
    font: var(--fs-sm)/1.4 var(--font-ui);
    resize: vertical;
    outline: none;
  }

  /* Replaces the outline above. A text box is always "focus-visible", pointer
     or keyboard, so this reads identically to the `:focus` it was written as. */
  .input:focus-visible {
    border-color: var(--accent);
  }

  .input::placeholder {
    color: var(--muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .btn {
    height: 24px;
    padding: 0 10px;
    border-radius: var(--r-md);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    font-weight: 500;
    cursor: pointer;
  }

  .cancel {
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text);
  }

  .cancel:hover {
    background: var(--surface2);
  }

  .save {
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
</style>
