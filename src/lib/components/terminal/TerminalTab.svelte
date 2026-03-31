<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { TerminalSession } from "../../terminal-session";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    tabId: string;
    visible: boolean;
    onPtyReady: (ptyId: number) => void;
  }

  let { tabId, visible, onPtyReady }: Props = $props();

  let containerEl: HTMLDivElement;
  let session: TerminalSession | null = null;

  onMount(() => {
    session = new TerminalSession({
      tabId,
      container: containerEl,
      visible,
      onPtyReady,
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
  }

  .terminal-container.hidden {
    visibility: hidden;
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .terminal-container :global(.xterm) {
    padding: 0.35rem 0.5rem;
    height: 100%;
  }
</style>
