<script lang="ts">
  /**
   * Asks what to do with unsaved edits before a tab closes or Atlas quits.
   * Save / Discard / Cancel; Esc and the overlay cancel (Modal owns Esc).
   */
  import { basename } from "../../format";
  import { parseFileKey } from "../../files";
  import { closeRequest, dirtyFiles, resolveCloseRequest } from "../../stores/files";
  import Button from "../ui/Button.svelte";
  import Modal from "../ui/Modal.svelte";

  let request = $derived($closeRequest);
  let names = $derived(
    request?.kind === "tab"
      ? [basename(parseFileKey(request.key).path)]
      : [...$dirtyFiles].map((k) => basename(parseFileKey(k).path)),
  );
  let quitting = $derived(request?.kind === "quit");
</script>

<Modal
  open={request !== null}
  onClose={() => void resolveCloseRequest("cancel")}
  title="Unsaved changes"
  width="420px"
>
  <p class="text">
    {#if quitting}
      {names.join(", ")} {names.length === 1 ? "has" : "have"} unsaved edits. Quit anyway?
    {:else}
      {names[0]} has unsaved edits.
    {/if}
  </p>
  {#snippet footer()}
    <!-- Cancel comes first in the DOM so Modal's initial focus lands on it. -->
    <Button onclick={() => void resolveCloseRequest("cancel")}>Cancel</Button>
    <Button variant="danger" onclick={() => void resolveCloseRequest("discard")}>
      {quitting ? "Discard and quit" : "Discard"}
    </Button>
    <Button variant="primary" onclick={() => void resolveCloseRequest("save")}>
      {quitting ? "Save all and quit" : "Save"}
    </Button>
  {/snippet}
</Modal>

<style>
  .text {
    margin: 0;
    padding: var(--sp-5);
    color: var(--muted);
    font-size: var(--fs-sm);
  }
</style>
