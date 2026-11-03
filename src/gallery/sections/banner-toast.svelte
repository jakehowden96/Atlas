<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Banner, { type BannerTone } from "../../lib/components/ui/Banner.svelte";
  import InlineAlert from "../../lib/components/ui/InlineAlert.svelte";
  import Toast from "../../lib/components/Toast.svelte";
  import { showToast, type Toast as ToastData } from "../../lib/stores/toast";

  const tones: BannerTone[] = ["info", "success", "warn", "error"];
  const types: ToastData["type"][] = ["info", "success", "warning", "error"];
</script>

<GallerySection title="Banner, inline alert, toast" states={["info", "success", "warn", "error"]}>
  <div class="col">
    {#each tones as tone (tone)}
      <Banner {tone} title="This is a {tone} banner" ondismiss={() => {}}>
        Body text explaining what happened.
        {#snippet actions()}
          <button type="button">Retry</button>
          <button type="button">Details</button>
        {/snippet}
      </Banner>
    {/each}
    <div>
      <input aria-label="Branch name" aria-describedby="branch-err" value="main" />
      <InlineAlert id="branch-err">That branch already exists</InlineAlert>
    </div>
    <div class="row">
      {#each types as type (type)}
        <button
          type="button"
          onclick={() => showToast(`A ${type} toast`, { type, body: "Detail line" })}
          >Fire {type}</button
        >
      {/each}
    </div>
  </div>
  <Toast />
</GallerySection>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
</style>
