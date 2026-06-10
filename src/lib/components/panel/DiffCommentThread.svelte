<script lang="ts">
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
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }
</script>

<div class="comment-row" data-anchor={anchorDomKey(anchor)}>
  {#each comments as c (c.id)}
    <div class="comment-item">
      <span class="comment-marker material-symbols-outlined">chat</span>
      <span class="comment-body">{c.body}</span>
      <button
        type="button"
        class="comment-dismiss"
        title="Dismiss this comment"
        aria-label="Dismiss comment"
        onclick={() => onDismiss(c.id)}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  {/each}
  {#if composerOpen}
    <div class="comment-composer">
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class="comment-input"
        placeholder="Leave a review comment… (⌘+Enter to save, Esc to cancel)"
        bind:value={body}
        onkeydown={composerKeydown}
        autofocus
        rows="2"
      ></textarea>
      <div class="comment-actions">
        <button type="button" class="comment-btn cancel" onclick={onClose}>Cancel</button>
        <button type="button" class="comment-btn save" onclick={save}>Save</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .comment-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px 8px;
    background: color-mix(in srgb, var(--primary) 6%, var(--surface));
    border-top: 1px solid color-mix(in srgb, var(--primary) 25%, var(--outline-variant));
    border-bottom: 1px solid color-mix(in srgb, var(--primary) 25%, var(--outline-variant));
  }

  .comment-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 8px;
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--on-surface);
    line-height: 1.4;
  }
  .comment-marker {
    color: var(--primary);
    font-size: 0.9rem !important;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .comment-body {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-word;
    min-width: 0;
  }
  .comment-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--on-surface-variant);
    cursor: pointer;
    flex-shrink: 0;
  }
  .comment-dismiss :global(.material-symbols-outlined) { font-size: 0.9rem; }
  .comment-dismiss:hover { background: var(--surface-container-high); color: var(--error); }

  .comment-composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    background: var(--surface-container-low);
    border: 1px solid var(--primary);
    border-radius: 6px;
  }
  .comment-input {
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    background: var(--surface);
    border: 1px solid var(--outline-variant);
    border-radius: 4px;
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 12px;
    line-height: 1.4;
    resize: vertical;
    outline: none;
  }
  .comment-input:focus { border-color: var(--primary); }
  .comment-input::placeholder { color: var(--on-surface-variant); opacity: 0.6; }

  .comment-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .comment-btn {
    padding: 3px 10px;
    border-radius: 4px;
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--outline-variant);
    background: var(--surface-container-high);
    color: var(--on-surface);
  }
  .comment-btn.cancel { background: transparent; color: var(--on-surface-variant); }
  .comment-btn.cancel:hover { color: var(--on-surface); background: var(--surface-container-high); }
  .comment-btn.save {
    background: var(--primary);
    color: var(--on-primary);
    border-color: var(--primary);
  }
  .comment-btn.save:hover {
    background: color-mix(in srgb, var(--primary) 88%, var(--on-surface));
  }
</style>
