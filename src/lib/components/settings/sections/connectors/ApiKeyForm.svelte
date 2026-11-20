<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import type { ConnectorInfo } from "../../../../../types/generated/ConnectorInfo";
  import { linkApiKey } from "../../../../stores/connectors";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

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
    aria-invalid={error ? true : undefined}
  />
  <Button variant="outline" size="sm" type="submit" disabled={busy || !key.trim()}>Use key</Button>
</form>
{#if error}<Alert.Root variant="destructive" layout="inline"><Icon name="error" /><Alert.Title>{error}</Alert.Title></Alert.Root>{/if}

<style>
  .key {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
  }
</style>
