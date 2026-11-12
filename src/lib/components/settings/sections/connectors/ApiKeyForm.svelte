<script lang="ts">
  import type { ConnectorInfo } from "../../../../../types/generated/ConnectorInfo";
  import { linkApiKey } from "../../../../stores/connectors";
  import Button from "../../../ui/Button.svelte";
  import InlineAlert from "../../../ui/InlineAlert.svelte";
  import Input from "../../../ui/Input.svelte";

  let { connector, onLinked }: { connector: ConnectorInfo; onLinked?: () => void } = $props();

  let key = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await linkApiKey(connector.id, key);
      key = "";
      onLinked?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<form class="key" onsubmit={save}>
  <Input
    type="password"
    mono
    bind:value={key}
    placeholder="Paste a personal API key"
    aria-label={`${connector.name} API key`}
    autocomplete="off"
    invalid={!!error}
  />
  <Button size="sm" type="submit" disabled={busy || !key.trim()}>Use key</Button>
</form>
{#if error}<InlineAlert>{error}</InlineAlert>{/if}

<style>
  .key {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
  }
</style>
