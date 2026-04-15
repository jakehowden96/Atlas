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

  // Re-fit terminal when ready transitions to true — the container was
  // position:absolute while hidden, so xterm had incorrect dimensions.
  $effect(() => {
    if (visible && ready) {
      session?.fitTerminal();
    }
  });
</script>

{#if visible && !ready}
  <div class="loading-overlay">
    <span class="material-symbols-outlined loading-spinner">progress_activity</span>
    <span class="loading-text">Starting Claude Code...</span>
  </div>
{/if}
<div
  class="terminal-container"
  class:hidden={!visible || !ready}
  bind:this={containerEl}
></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--surface);
  }

  .terminal-container.hidden {
    visibility: hidden;
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .terminal-container :global(.xterm) {
    padding: 0 0 0 6px;
    height: 100%;
    margin-top: 2px;
    background: var(--surface);
  }

  .loading-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    background: var(--surface);
  }

  .loading-spinner {
    font-size: 1.5rem;
    color: var(--primary);
    animation: spin 1s linear infinite;
  }

  .loading-text {
    font-size: 0.8rem;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
