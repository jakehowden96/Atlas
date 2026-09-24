<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { TerminalSession } from "../../terminal-session";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    tabId: string;
    visible: boolean;
    ready?: boolean;
    onPtyReady: (ptyId: number) => void;
    cwd?: string;
    onData?: (data: string) => void;
  }

  let { tabId, visible, ready = true, onPtyReady, cwd, onData }: Props = $props();

  let containerEl: HTMLDivElement;
  let session: TerminalSession | null = null;

  onMount(() => {
    session = new TerminalSession({
      tabId,
      container: containerEl,
      visible,
      onPtyReady,
      cwd,
      onData,
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

{#if !ready}
  <div class="loading-overlay">
    <span class="material-symbols-outlined loading-spinner">progress_activity</span>
    <span class="loading-text">Starting Claude Code...</span>
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
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    background: var(--term-bg);
  }

  .loading-spinner {
    font-size: 1.5rem;
    color: var(--accent);
    animation: spin 1s linear infinite;
  }

  .loading-text {
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
