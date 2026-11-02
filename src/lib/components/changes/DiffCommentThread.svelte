<script lang="ts">
  import { enterLabel } from "../../platform";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Textarea from "../ui/Textarea.svelte";
  import { anchorDomKey, type ReviewAnchor, type ReviewComment } from "../../stores/reviewComments";

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
    } else if (e.key === "Enter" && !e.shiftKey) {
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
        <IconButton
          icon="delete"
          size="sm"
          label="Delete comment"
          onclick={() => onDismiss(c.id)}
        />
      </div>
      <div class="caption">Review comment · line {lineNum} · pending</div>
    </div>
  {/each}

  {#if composerOpen}
    <div class="card composer">
      <!-- svelte-ignore a11y_autofocus -->
      <Textarea
        aria-label="Review comment"
        placeholder={`Leave a review comment… (${enterLabel()} to save, Shift+${enterLabel()} for a new line, Esc to cancel)`}
        bind:value={body}
        onkeydown={composerKeydown}
        autofocus
        rows={2}
      />
      <div class="actions">
        <Button size="sm" onclick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onclick={save}>Save</Button>
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

  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 480px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
