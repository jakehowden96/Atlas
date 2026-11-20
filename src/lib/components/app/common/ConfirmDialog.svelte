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
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

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

  let cancel = $state<HTMLButtonElement | null>(null);
</script>

<AlertDialog.Root {open} onOpenChange={(o) => !o && onCancel()}>
  <!-- Cancel takes the first focus, so a stray Enter never confirms a destructive action. -->
  <AlertDialog.Content
    size="sm"
    onOpenAutoFocus={(e) => {
      e.preventDefault();
      cancel?.focus();
    }}
  >
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{body}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel bind:ref={cancel}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        variant={tone === "danger" ? "destructive" : "default"}
        onclick={onConfirm}
      >
        {confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
