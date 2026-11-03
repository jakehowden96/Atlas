<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { closeSessionForTab, handleTerminalExit, retrySessionForTab } from "../../session-actions";
  import { TerminalSession } from "../../terminal-session";
  import { copyText } from "../../ui/copy";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import Spinner from "../ui/Spinner.svelte";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    tabId: string;
    visible: boolean;
    ready?: boolean;
    /** Set once the PTY failed to spawn; replaces the loading overlay. */
    spawnError?: string;
    /** Names the harness in the loading overlay. */
    harnessLabel?: string;
    onPtyReady: (ptyId: number) => void;
    onSpawnError: (message: string) => void;
    cwd?: string;
  }

  let {
    tabId,
    visible,
    ready = true,
    spawnError,
    harnessLabel = "session",
    onPtyReady,
    onSpawnError,
    cwd,
  }: Props = $props();

  let containerEl: HTMLDivElement;
  let session: TerminalSession | null = null;

  onMount(() => {
    session = new TerminalSession({
      tabId,
      container: containerEl,
      visible,
      onPtyReady,
      onSpawnError,
      onExit: () => void handleTerminalExit(tabId),
      cwd,
    });
  });

  onDestroy(() => {
    session?.destroy();
  });

  $effect(() => {
    session?.handleVisibilityChange(visible);
  });

  // Re-fit terminal when ready transitions to true, in case the container
  // was resized while the loading overlay covered it.
  $effect(() => {
    if (visible && ready) {
      session?.fitTerminal();
    }
  });
</script>

{#if spawnError}
  <div class="loading-overlay">
    <Banner tone="error" title="Could not start the terminal">
      <span class="error-detail">{spawnError}</span>
      {#snippet actions()}
        <Button onclick={() => void copyText(spawnError)}>Copy details</Button>
        <Button onclick={() => void retrySessionForTab(tabId)}>Retry</Button>
        <Button onclick={() => void closeSessionForTab(tabId)}>Close session</Button>
      {/snippet}
    </Banner>
  </div>
{:else if !ready}
  <div class="loading-overlay">
    <Spinner label={`Starting ${harnessLabel}`} />
  </div>
{/if}
<div class="terminal-container" bind:this={containerEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--term-bg);
  }

  .terminal-container :global(.xterm) {
    padding: 0 0 0 6px;
    height: 100%;
    margin-top: 2px;
    background: var(--term-bg);
  }

  .terminal-container :global(.xterm .xterm-viewport) {
    background-color: var(--term-bg) !important;
  }

  /* Absolute rather than a sibling in flow: the container beneath it is
     always mounted now (visibility is purely "which parent holds the host"),
     so the overlay has to cover it in place instead of pushing it down. Its
     positioned ancestor is the registry's host div — see
     `terminal-registry.svelte.ts`. */
  .loading-overlay {
    position: absolute;
    inset: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    background: var(--term-bg);
    padding: var(--sp-5);
  }

  .error-detail {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
</style>
