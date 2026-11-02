<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import DropTarget from "../../lib/components/ui/DropTarget.svelte";
  import type { DragState } from "../../lib/drop";

  const states: [string, DragState][] = [
    ["One folder", { kind: "over", folders: 1, files: 0 }],
    ["Two folders", { kind: "over", folders: 2, files: 0 }],
    ["File only", { kind: "over", folders: 0, files: 1 }],
  ];
  let shown = $state<number | null>(null);
</script>

<GallerySection title="Drop target" states={["one folder", "two folders", "file only"]}>
  <div class="row">
    {#each states as [label], i (label)}
      <button type="button" onclick={() => (shown = shown === i ? null : i)}>{label}</button>
    {/each}
  </div>
</GallerySection>

{#if shown !== null}
  <DropTarget state={states[shown]![1]} />
{/if}

<style>
  .row {
    display: flex;
    gap: var(--sp-3);
  }
</style>
