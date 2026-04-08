<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { TerminalSession } from "../../terminal-session";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    tabId: string;
    visible: boolean;
    onPtyReady: (ptyId: number) => void;
    cwd?: string;
    onData?: (data: string) => void;
  }

  let { tabId, visible, onPtyReady, cwd, onData }: Props = $props();

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
</script>

<div
  class="terminal-container"
  class:hidden={!visible}
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
  }
</style>
