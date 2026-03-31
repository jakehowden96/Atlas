<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import SidePanel from "./lib/components/panel/SidePanel.svelte";
  import Resizer from "./lib/components/layout/Resizer.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import { panelVisible, panelData } from "./lib/stores/panel";
  import { onPanelUpdate } from "./lib/ipc";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let panelWidth = $state(420);
  let unlisten: UnlistenFn | null = null;

  const MIN_PANEL_WIDTH = 280;
  const MAX_PANEL_WIDTH = 800;

  function handleResize(delta: number) {
    panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, panelWidth + delta));
  }

  onMount(async () => {
    unlisten = await onPanelUpdate((data) => {
      panelData.set(data);
    });
  });

  onDestroy(() => {
    unlisten?.();
  });
</script>

<div class="app">
  <div class="main-content">
    <TerminalContainer />
  </div>
  {#if $panelVisible}
    <Resizer onResize={handleResize} />
    <div class="panel" style="width: {panelWidth}px">
      <SidePanel />
    </div>
  {/if}
</div>
<Toast />

<style>
  :global(:root) {
    --bg: #1a1b26;
    --bg-dark: #13141c;
    --bg-light: #1e2030;
    --fg: #a9b1d6;
    --fg-bright: #c0caf5;
    --fg-muted: #787c99;
    --fg-dim: #444b6a;
    --fg-subtle: #565f89;
    --border: #292d3e;
    --border-light: #3b4261;
    --red: #f7768e;
    --green: #9ece6a;
    --yellow: #e0af68;
    --blue: #7aa2f7;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app {
    display: flex;
    height: 100vh;
    width: 100vw;
  }

  .main-content {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .panel {
    flex-shrink: 0;
    overflow: hidden;
  }
</style>
