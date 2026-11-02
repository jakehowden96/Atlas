<script lang="ts">
  import ChipInput from "../../lib/components/ui/ChipInput.svelte";
  import NumberStepper from "../../lib/components/ui/NumberStepper.svelte";
  import GallerySection from "../GallerySection.svelte";

  let size = $state(13);
  let repos = $state(["acme/web", "acme/api"]);
  let withError = $state<string[]>([]);
  const validate = (v: string) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? null : "Use the form owner/name");
</script>

<GallerySection
  title="Number stepper and chip input"
  states={["default", "bounds", "disabled", "error"]}
>
  <div class="col">
    <NumberStepper bind:value={size} min={10} max={24} label="Terminal font size" />
    <NumberStepper value={10} min={10} max={24} label="At minimum" />
    <NumberStepper value={12} label="Disabled" disabled />
    <ChipInput bind:value={repos} label="Watched repos" placeholder="owner/name" {validate} />
    <!-- Type a bad value and tab away to see the error state. -->
    <ChipInput bind:value={withError} label="Validated repos" placeholder="owner/name" {validate} />
  </div>
</GallerySection>

<style>
  .col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    max-width: 420px;
  }
</style>
