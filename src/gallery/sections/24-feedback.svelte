<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Spinner from "../../lib/components/ui/Spinner.svelte";
  import Progress from "../../lib/components/ui/Progress.svelte";
  import Skeleton from "../../lib/components/ui/Skeleton.svelte";
  import EmptyState from "../../lib/components/ui/EmptyState.svelte";
</script>

<GallerySection title="Feedback" states={["light", "dark", "reduced motion"]}>
  <div class="stack">
    <Spinner label="Scanning transcripts" />
    <Spinner label="Loading" hideLabel />
    <Progress label="Reading transcripts" value={12} max={40} count="12 / 40" />
    <Progress label="Scanning" />
    <Skeleton width="60%" />
    <Skeleton width="var(--sp-9)" height="var(--h-md)" radius="md" />
    <EmptyState
      icon="folder"
      title="No sessions yet"
      description="Start one from the new session button"
    />
    <EmptyState compact icon="folder" title="Nothing here" />
  </div>
</GallerySection>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }
</style>
