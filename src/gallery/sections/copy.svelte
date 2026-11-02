<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import CopyButton from "../../lib/components/ui/CopyButton.svelte";
</script>

<GallerySection title="Copy" states={["light", "dark"]}>
  <div class="row">
    <CopyButton value="C:\Users\example\project" label="Copy path" />
    <CopyButton variant="text" value="pnpm install" label="Copy command" />
  </div>
</GallerySection>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
  }
</style>
