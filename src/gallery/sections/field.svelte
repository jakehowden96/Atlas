<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Field from "../../lib/components/ui/Field.svelte";
  import Input from "../../lib/components/ui/Input.svelte";
  import Textarea from "../../lib/components/ui/Textarea.svelte";
  import SearchInput from "../../lib/components/ui/SearchInput.svelte";

  let text = $state("");
  let filled = $state("atlas-main");
  let area = $state("Notes for the team");
  let q = $state("");
  let qFilled = $state("rail");
  let saved = $state(false);

  function commit() {
    saved = false;
    queueMicrotask(() => (saved = true));
  }
</script>

<GallerySection
  title="Field, Input, Textarea, SearchInput"
  states={["default", "hover", "focus", "filled", "error", "disabled", "saved"]}
>
  <div class="grid">
    <Field label="Default" help="Help text sits below" optional>
      {#snippet children(p)}<Input {...p} bind:value={text} placeholder="Placeholder" />{/snippet}
    </Field>
    <Field label="Filled" required>
      {#snippet children(p)}<Input {...p} bind:value={filled} mono />{/snippet}
    </Field>
    <Field label="Error" error="Enter a branch name">
      {#snippet children(p)}<Input {...p} value="" />{/snippet}
    </Field>
    <Field label="Disabled">
      {#snippet children(p)}<Input {...p} value="Locked" disabled />{/snippet}
    </Field>
    <Field label="Saved on commit" {saved}>
      {#snippet children(p)}<Input {...p} value="Edit then blur" oncommit={commit} />{/snippet}
    </Field>
    <Field label="Textarea" help="Up to 120 characters">
      {#snippet children(p)}<Textarea {...p} bind:value={area} maxlength={120} />{/snippet}
    </Field>
    <Field label="Textarea error" error="Too short">
      {#snippet children(p)}<Textarea {...p} value="" />{/snippet}
    </Field>
    <Field label="Textarea disabled">
      {#snippet children(p)}<Textarea {...p} value="Locked" disabled />{/snippet}
    </Field>
    <SearchInput bind:value={q} aria-label="Search empty" placeholder="Search" />
    <SearchInput bind:value={qFilled} aria-label="Search filled" />
    <SearchInput value="" aria-label="Search disabled" disabled placeholder="Search" />
  </div>
</GallerySection>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--sp-5);
  }
</style>
