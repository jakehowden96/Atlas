<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Overlays from "./lib/components/shell/Overlays.svelte";
  import TopBar from "./lib/components/shell/TopBar.svelte";
  import ViewHost from "./lib/components/shell/ViewHost.svelte";
  import { bootApp } from "./lib/app-boot";
  import { log } from "./lib/logger";
  import { shouldClearNeedsInput } from "./lib/overview";
  import { handleGlobalKeydown } from "./lib/shortcuts";
  import { startCostRefresh } from "./lib/stores/cost";
  import { activeTabId, setTabNeedsInput } from "./lib/stores/terminal";
  import { activeView } from "./lib/stores/view";

  // Clear needsInput once the user is actually looking at the session — see
  // `shouldClearNeedsInput`. Gating on `$activeTabId` alone cleared the flag
  // off sessions nobody had opened, because `activeTabId` moves on a spawn, on
  // a neighbouring tab closing and on SessionView reconciling itself while it
  // is hidden behind another view.
  $effect(() => {
    if (shouldClearNeedsInput($activeView, $activeTabId)) {
      setTabNeedsInput($activeTabId, false);
    }
  });

  // `bootApp` is async and the component can be torn down before it settles.
  let stopBoot: (() => void) | null = null;
  let destroyed = false;
  let stopCosts: (() => void) | null = null;
  onMount(() => {
    stopCosts = startCostRefresh();
    bootApp()
      .then((stop) => {
        if (destroyed) stop();
        else stopBoot = stop;
      })
      .catch((e) => log.error("app", "boot failed", e));
  });

  onDestroy(() => {
    destroyed = true;
    stopCosts?.();
    stopBoot?.();
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="app">
  <TopBar />
  <ViewHost />
</div>

<Overlays />

<style>
  /* Keep terminal at its own font size — xterm manages this internally */
  :global(.xterm) {
    font-size: initial;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--bg);
  }
</style>
