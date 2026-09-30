<script lang="ts">
  /**
   * Asks what to do with unsaved edits before a tab closes or Atlas quits.
   * Save / Discard / Cancel; Esc and the overlay cancel.
   */
  import { basename } from "../../format";
  import { parseFileKey } from "../../files";
  import { closeRequest, dirtyFiles, resolveCloseRequest } from "../../stores/files";
  import Modal from "../ui/Modal.svelte";

  let request = $derived($closeRequest);
  let names = $derived(
    request?.kind === "tab"
      ? [basename(parseFileKey(request.key).path)]
      : [...$dirtyFiles].map((k) => basename(parseFileKey(k).path)),
  );
  let quitting = $derived(request?.kind === "quit");

  function onKeydown(e: KeyboardEvent) {
    if (request && e.key === "Escape") {
      e.preventDefault();
      void resolveCloseRequest("cancel");
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Modal open={request !== null} onClose={() => void resolveCloseRequest("cancel")} width="420px">
  <div class="dialog">
    <h2>Unsaved changes</h2>
    <p>
      {#if quitting}
        {names.join(", ")} {names.length === 1 ? "has" : "have"} unsaved edits. Quit anyway?
      {:else}
        {names[0]} has unsaved edits.
      {/if}
    </p>
    <div class="actions">
      <button type="button" onclick={() => void resolveCloseRequest("cancel")}>Cancel</button>
      <button type="button" onclick={() => void resolveCloseRequest("discard")}>
        {quitting ? "Discard and quit" : "Discard"}
      </button>
      <button type="button" class="primary" onclick={() => void resolveCloseRequest("save")}>
        {quitting ? "Save all and quit" : "Save"}
      </button>
    </div>
  </div>
</Modal>

<style>
  .dialog {
    padding: 18px 20px;
  }

  h2 {
    margin: 0 0 8px;
    color: var(--text);
    font-size: var(--fs-md);
    font-weight: 600;
  }

  p {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  button.primary {
    border-color: transparent;
    background: var(--ink);
    color: var(--ink-text);
  }
</style>
