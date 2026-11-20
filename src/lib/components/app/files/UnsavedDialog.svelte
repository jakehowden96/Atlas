<script lang="ts">
  /**
   * Asks what to do with unsaved edits before a tab closes or Atlas quits.
   * Save / Discard / Cancel; Esc cancels.
   */
  import { basename } from "../../../format";
  import { parseFileKey } from "../../../files";
  import { closeRequest, dirtyFiles, resolveCloseRequest } from "../../../stores/files";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

  let request = $derived($closeRequest);
  let names = $derived(
    request?.kind === "tab"
      ? [basename(parseFileKey(request.key).path)]
      : [...$dirtyFiles].map((k) => basename(parseFileKey(k).path)),
  );
  let quitting = $derived(request?.kind === "quit");
  let cancel = $state<HTMLButtonElement | null>(null);
</script>

<AlertDialog.Root
  open={request !== null}
  onOpenChange={(o) => !o && void resolveCloseRequest("cancel")}
>
  <!-- Cancel takes the first focus, so a stray Enter never discards work. -->
  <AlertDialog.Content
    size="sm"
    onOpenAutoFocus={(e) => {
      e.preventDefault();
      cancel?.focus();
    }}
  >
    <AlertDialog.Header>
      <AlertDialog.Title>Unsaved changes</AlertDialog.Title>
      <AlertDialog.Description>
        {#if quitting}
          {names.join(", ")} {names.length === 1 ? "has" : "have"} unsaved edits. Quit anyway?
        {:else}
          {names[0]} has unsaved edits.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel bind:ref={cancel}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => void resolveCloseRequest("discard")}>
        {quitting ? "Discard and quit" : "Discard"}
      </AlertDialog.Action>
      <AlertDialog.Action variant="default" onclick={() => void resolveCloseRequest("save")}>
        {quitting ? "Save all and quit" : "Save"}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
