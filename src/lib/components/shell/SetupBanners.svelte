<script lang="ts">
  import {
    claudeHook,
    setClaudeHookEnabled,
    setTailTranscripts,
    tailTranscripts,
  } from "../../stores/settings";
  import { errorMessage } from "../../ipc-error";
  import { onMount } from "svelte";
  import { claudeHookStale, refreshHookStale } from "../../stores/claude";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";

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
  <Banner tone="warn" title="Hooks not installed">
    Needs-you alerts are off until Atlas's hooks are in your Claude settings.{#if error}
      {error}{/if}
    {#snippet actions()}
      <Button size="sm" variant="secondary" onclick={() => (hooksDismissed = true)}>Not now</Button>
      <Button size="sm" variant="primary" onclick={installHooks}>Install hooks</Button>
    {/snippet}
  </Banner>
{/if}
{#if $claudeHook && $claudeHookStale}
  <Banner tone="warn" title="Claude hook out of date">
    Atlas's hooks in your Claude settings are from an older build.{#if error}
      {error}{/if}
    {#snippet actions()}
      <Button size="sm" variant="primary" onclick={installHooks}>Update</Button>
    {/snippet}
  </Banner>
{/if}
{#if !$tailTranscripts}
  <Banner tone="info" title="Transcript tailing is off">
    Tiles and the session rail will not update from Claude's transcripts.
    {#snippet actions()}
      <Button size="sm" variant="secondary" onclick={() => setTailTranscripts(true)}>Turn on</Button
      >
    {/snippet}
  </Banner>
{/if}
