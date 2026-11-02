<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Select from "../../lib/components/ui/Select.svelte";
  import Field from "../../lib/components/ui/Field.svelte";

  const few = [
    { id: "a", label: "Atlas", description: "Main workspace" },
    { id: "b", label: "Sandbox" },
    { id: "c", label: "Archive", disabled: true },
  ];
  const grouped = [
    { id: "1", label: "main", group: "Branches" },
    { id: "2", label: "develop", group: "Branches" },
    { id: "3", label: "v1.0", group: "Tags" },
    { id: "4", label: "v2.0", group: "Tags" },
  ];
  const long = Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, label: `Option ${i + 1}` }));

  let closed = $state<string | undefined>("a");
  let g = $state<string | undefined>();
  let l = $state<string | undefined>("30");
  let v = $state<string | undefined>();
</script>

<GallerySection title="Select" states={["closed", "open", "grouped", "long list", "invalid", "disabled"]}>
  <div class="col">
    <Field label="Workspace">{#snippet children(p)}<Select {...p} options={few} bind:value={closed} />{/snippet}</Field>
    <Field label="Ref">{#snippet children(p)}<Select {...p} options={grouped} bind:value={g} placeholder="Pick a ref" />{/snippet}</Field>
    <Field label="Long list">{#snippet children(p)}<Select {...p} options={long} bind:value={l} />{/snippet}</Field>
    <Field label="Invalid" error="Choose a workspace">{#snippet children(p)}<Select {...p} options={few} bind:value={v} />{/snippet}</Field>
    <Field label="Disabled">{#snippet children(p)}<Select {...p} options={few} value="b" disabled />{/snippet}</Field>
    <Field label="Small">{#snippet children(p)}<Select {...p} options={few} value="b" size="sm" />{/snippet}</Field>
  </div>
</GallerySection>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    max-width: 280px;
  }
</style>
