<script lang="ts">
  import Field from "../components/ui/Field.svelte";
  import Input from "../components/ui/Input.svelte";

  let {
    help,
    error,
    saved,
    oncommit,
    disabled,
  }: {
    help?: string;
    error?: string;
    saved?: boolean;
    oncommit?: (v: string) => void;
    disabled?: boolean;
  } = $props();
  let value = $state("");
</script>

<Field label="Name" {help} {error} {saved}>
  {#snippet children(p)}
    <Input {...p} {disabled} bind:value {oncommit} />
  {/snippet}
</Field>
