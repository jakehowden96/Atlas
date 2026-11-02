<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import ErrorBoundary from "../../lib/components/ui/ErrorBoundary.svelte";
  import Thrower from "../../lib/__tests__/ThrowerFixture.svelte";

  const fail = { on: true };
</script>

<GallerySection title="Error boundary" states={["light", "dark"]}>
  <div class="view">
    <ErrorBoundary name="Review"><Thrower {fail} /></ErrorBoundary>
  </div>
</GallerySection>

<style>
  .view {
    width: 100%;
    height: 320px;
  }
</style>
