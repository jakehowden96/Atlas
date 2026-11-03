<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Checkbox from "../../lib/components/ui/Checkbox.svelte";
  import RadioGroup from "../../lib/components/ui/RadioGroup.svelte";
  import Toggle from "../../lib/components/ui/Toggle.svelte";

  let on = $state(true);
  let off = $state(false);
  let plan = $state("a");
  const options = [
    { value: "a", label: "Option A", description: "First choice" },
    { value: "b", label: "Option B" },
    { value: "c", label: "Option C (disabled)", disabled: true },
  ];
</script>

<GallerySection
  title="Choice controls"
  states={["on", "off", "indeterminate", "disabled", "focus"]}
>
  <div class="row">
    <Checkbox checked>On</Checkbox>
    <Checkbox>Off</Checkbox>
    <Checkbox indeterminate>Indeterminate</Checkbox>
    <Checkbox disabled>Disabled</Checkbox>
    <Checkbox checked disabled>Disabled on</Checkbox>
  </div>
  <div class="row">
    <RadioGroup {options} bind:value={plan} label="Plan" />
  </div>
  <div class="row">
    <Toggle checked={on} onChange={(v) => (on = v)} label="On" />
    <Toggle checked={off} onChange={(v) => (off = v)} label="Off" />
    <Toggle checked={false} onChange={() => {}} label="Disabled" disabled />
    <Toggle checked onChange={() => {}} label="Disabled on" disabled />
  </div>
  <p class="hint">Tab into any control to see the focus ring.</p>
</GallerySection>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .hint {
    color: var(--muted);
    font-size: var(--fs-xs);
    margin: 0;
  }
</style>
