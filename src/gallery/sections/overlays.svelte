<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Modal from "../../lib/components/ui/Modal.svelte";
  import Drawer from "../../lib/components/ui/Drawer.svelte";
  import ConfirmDialog from "../../lib/components/ui/ConfirmDialog.svelte";

  type Which = "m480" | "m640" | "m960" | "drawer" | "confirm" | null;
  let which = $state<Which>(null);
  const close = () => (which = null);
  const sizes = [
    ["m480", "480px"],
    ["m640", "640px"],
    ["m960", "960px"],
  ] as const;
  const lines = Array.from({ length: 40 }, (_, i) => `Row ${i + 1}`);
</script>

<GallerySection title="Overlays" states={["modal 480/640/960", "drawer", "confirm"]}>
  <div class="row">
    {#each sizes as [k, w] (k)}
      <button type="button" onclick={() => (which = k)}>Modal {w}</button>
    {/each}
    <button type="button" onclick={() => (which = "drawer")}>Drawer</button>
    <button type="button" onclick={() => (which = "confirm")}>Destructive confirm</button>
  </div>
</GallerySection>

{#each sizes as [k, w] (k)}
  <Modal open={which === k} onClose={close} title="Tall content" width={w}>
    <div class="pad">
      {#each lines as l (l)}<p>{l}</p>{/each}
    </div>
    {#snippet footer()}
      <button type="button" onclick={close}>Cancel</button>
      <button type="button" onclick={close}>Save</button>
    {/snippet}
  </Modal>
{/each}

<Drawer open={which === "drawer"} onClose={close} title="Changes">
  <div class="pad">
    {#each lines as l (l)}<p>{l}</p>{/each}
  </div>
  {#snippet footer()}
    <button type="button" onclick={close}>Close</button>
  {/snippet}
</Drawer>

<ConfirmDialog
  open={which === "confirm"}
  title="Delete this session?"
  body="The session and its history are removed. This cannot be undone."
  confirmLabel="Delete session"
  onConfirm={close}
  onCancel={close}
/>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
  }
  .pad {
    padding: var(--sp-5);
  }
  p {
    margin: 0 0 var(--sp-3);
  }
</style>
