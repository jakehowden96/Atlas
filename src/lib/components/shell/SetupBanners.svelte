<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import {
    claudeHook,
    setClaudeHookEnabled,
    setTailTranscripts,
    tailTranscripts,
  } from "../../stores/settings";
  import { errorMessage } from "../../ipc-error";
  import { onMount } from "svelte";
  import { claudeHookStale, refreshHookStale } from "../../stores/claude";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";

  // Dismissal lasts until next launch, so it is deliberately not persisted.
  let hooksDismissed = $state(false);
  let error = $state("");

  onMount(() => void refreshHookStale());

  async function installHooks() {
    error = "";
    try {
      await setClaudeHookEnabled(true);
      await refreshHookStale();
    } catch (e) {
      error = errorMessage(e);
    }
  }
</script>

{#if !$claudeHook && !hooksDismissed}
  <Alert.Root variant="warning">
<Icon name="warning" />
<Alert.Title>Hooks not installed</Alert.Title>
<Alert.Description>Needs-you alerts are off until Atlas's hooks are in your Claude settings.{#if error}
      {error}{/if}</Alert.Description>
<Alert.Action><Button size="sm" variant="outline" onclick={() => (hooksDismissed = true)}>Not now</Button>
      <Button size="sm" variant="default" onclick={installHooks}>Install hooks</Button></Alert.Action>
</Alert.Root>
{/if}
{#if $claudeHook && $claudeHookStale}
  <Alert.Root variant="warning">
<Icon name="warning" />
<Alert.Title>Claude hook out of date</Alert.Title>
<Alert.Description>Atlas's hooks in your Claude settings are from an older build.{#if error}
      {error}{/if}</Alert.Description>
<Alert.Action><Button size="sm" variant="default" onclick={installHooks}>Update</Button></Alert.Action>
</Alert.Root>
{/if}
{#if !$tailTranscripts}
  <Alert.Root variant="default">
<Icon name="info" />
<Alert.Title>Transcript tailing is off</Alert.Title>
<Alert.Description>Tiles and the session rail will not update from Claude's transcripts.</Alert.Description>
<Alert.Action><Button size="sm" variant="outline" onclick={() => setTailTranscripts(true)}>Turn on</Button
      ></Alert.Action>
</Alert.Root>
{/if}
