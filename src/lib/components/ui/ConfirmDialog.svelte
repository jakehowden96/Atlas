<script module lang="ts">
  import { mount, unmount } from "svelte";
  import Self from "./ConfirmDialog.svelte";

  export interface ConfirmOptions {
    title: string;
    body: string;
    confirmLabel: string;
    tone?: "danger" | "default";
  }

  /** Imperative confirm: resolves true on confirm, false on cancel, Esc or overlay click. */
  export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const props = $state({
        ...opts,
        open: true,
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      });
      const instance = mount(Self, { target: document.body, props });
      let done = false;
      function settle(result: boolean) {
        if (done) return;
        done = true;
        props.open = false;
        resolve(result);
        // Let the exit animation finish before the node leaves the DOM.
        setTimeout(() => unmount(instance), 400);
      }
    });
  }
</script>

<script lang="ts">
  import Modal from "./Modal.svelte";

  interface Props {
    open: boolean;
    /** The question, e.g. "Delete this session?" */
    title: string;
    /** What is lost, and that it cannot be undone. */
    body: string;
    /** The verb on the action button. */
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    tone?: "danger" | "default";
  }

  let { open, title, body, confirmLabel, onConfirm, onCancel, tone = "danger" }: Props = $props();
</script>

<Modal {open} onClose={onCancel} {title} width="420px">
  <p class="text">{body}</p>
  {#snippet footer()}
    <!-- Cancel comes first in the DOM so Modal's initial focus lands on it. -->
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
    <button type="button" class="btn primary" class:danger={tone === "danger"} onclick={onConfirm}>
      {confirmLabel}
    </button>
  {/snippet}
</Modal>

<style>
  .text {
    margin: 0;
    padding: var(--sp-5);
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .btn {
    height: var(--h-md);
    padding: 0 var(--sp-4);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .btn:hover {
    background: var(--hover-bg);
  }

  .btn.primary {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--bg);
  }

  .btn.primary:hover {
    background: var(--ink-hover-bg);
  }

  .btn.danger {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--surface);
  }
</style>
