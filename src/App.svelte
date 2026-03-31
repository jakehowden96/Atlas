<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import SidePanel from "./lib/components/panel/SidePanel.svelte";
  import Resizer from "./lib/components/layout/Resizer.svelte";
  import Header from "./lib/components/layout/Header.svelte";
  import Sidebar from "./lib/components/layout/Sidebar.svelte";
  import StatusBar from "./lib/components/layout/StatusBar.svelte";
  import CommandRunner from "./lib/components/layout/CommandRunner.svelte";
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
  <Header />
  <div class="app-body">
    <Sidebar />
    <div class="main-stage">
      <div class="terminal-section">
        <TerminalContainer />
      </div>
      {#if $panelVisible}
        <Resizer onResize={handleResize} />
        <div class="panel-section" style="width: {panelWidth}px">
          <SidePanel />
        </div>
      {/if}
    </div>
  </div>
  <StatusBar />
</div>
<CommandRunner />
<Toast />

<style>
  :global(:root) {
    /* Surface hierarchy (tonal depth) */
    --surface: #0a0e14;
    --surface-container-lowest: #000000;
    --surface-container-low: #0f141a;
    --surface-container-high: #1b2028;
    --surface-container-highest: #20262f;
    --surface-bright: #262c36;

    /* Foreground */
    --on-surface: #f1f3fc;
    --on-surface-variant: #a8abb3;

    /* Outline */
    --outline-variant: #44484f;

    /* Primary */
    --primary: #72b1ff;
    --primary-container: #55a3fc;
    --on-primary: #002f58;
    --primary-dim: #4a8ad4;

    /* Secondary */
    --secondary: #97f999;
    --secondary-container: #006e23;

    /* Error */
    --error: #ff716c;
    --error-container: #9f0519;

    /* Tertiary */
    --tertiary: #ff7167;

    /* Named colors */
    --yellow: #e8be7b;

    /* Radius */
    --radius: 8px;
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;

    /* Spacing scale */
    --spacing-2-5: 0.5rem;
    --spacing-4: 0.9rem;
    --spacing-5: 1.1rem;

    /* Additional surface */
    --surface-container: #151a21;

    /* Typography */
    --font-display: "Space Grotesk Variable", "Space Grotesk", sans-serif;
    --font-body: "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: "JetBrains Mono Variable", "JetBrains Mono", "Fira Code", Menlo, monospace;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: var(--surface);
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(::selection) {
    background: color-mix(in srgb, var(--primary) 35%, transparent);
    color: var(--on-surface);
  }

  :global(.material-symbols-outlined) {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    font-size: 1.25rem;
    vertical-align: middle;
  }

  :global(::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: color-mix(in srgb, var(--outline-variant) 50%, transparent);
    border-radius: 3px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--outline-variant);
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .main-stage {
    flex: 1;
    display: flex;
    min-width: 0;
    overflow: hidden;
  }

  .terminal-section {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    background: var(--surface);
  }

  .panel-section {
    flex-shrink: 0;
    overflow: hidden;
    background: var(--surface-container-low);
  }
</style>
