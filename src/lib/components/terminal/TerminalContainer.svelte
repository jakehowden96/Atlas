<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { chords } from "../../stores/settings";
  import { getSessionDir } from "../../ipc";
  import { tabs } from "../../stores/terminal";
  import { showToast } from "../../stores/toast";
  import { activeView } from "../../stores/view";
  import {
    destroyTerminalTab,
    ensureTerminalTab,
    placeTerminals,
    setPaneSize,
    setPaneSlot,
  } from "../../terminal-registry.svelte";

  interface Props {
    /**
     * The session terminal to show. Every other tab's host stays mounted in
     * the registry's parking root — remounting an xterm loses its scrollback
     * and detaches its PTY, so switching sessions must never unmount one.
     */
    visibleTabId: string;
  }

  let { visibleTabId }: Props = $props();

  /**
   * No terminal counts as visible while another screen is up.
   *
   * This is what focuses the terminal on arrival. Session view stays mounted
   * for the life of the app, so switching to it changes no tab's `visible` —
   * `TerminalSession.handleVisibilityChange` never fired, nothing called
   * `focus()`, and reaching the prompt took a click. Folding the view in makes
   * every entry a false → true transition, which is the path that already
   * refits and focuses when you switch between two sessions.
   */
  let showing = $derived($activeView === "session");

  async function handlePtyReady(tabId: string, ptyId: number) {
    tabs.update((t) => t.map((tab) => (tab.id === tabId ? { ...tab, ptyId } : tab)));
    try {
      await getSessionDir(tabId);
    } catch (e) {
      showToast("Failed to create session directory", { body: String(e) });
    }
  }

  let paneEl: HTMLDivElement;
  let paneObserver: ResizeObserver | null = null;

  onMount(() => {
    setPaneSlot(paneEl);
    paneObserver = new ResizeObserver(() => {
      setPaneSize({ w: paneEl.clientWidth, h: paneEl.clientHeight });
    });
    paneObserver.observe(paneEl);
  });

  onDestroy(() => {
    paneObserver?.disconnect();
    setPaneSlot(null);
  });

  // Keep the registry in sync with `$tabs`: `ensureTerminalTab` mounts a host
  // on first call and just updates its reactive props on every later one, so
  // this can call it unconditionally for every live tab. Only tearing down a
  // host whose tab is gone needs last-tick bookkeeping.
  let liveTabIds = new Set<string>();
  $effect(() => {
    const nextIds = new Set<string>();
    for (const tab of $tabs) {
      nextIds.add(tab.id);
      ensureTerminalTab(tab.id, {
        tabId: tab.id,
        visible: showing && tab.id === visibleTabId,
        ready: tab.ready !== false,
        cwd: tab.cwd,
        onData: tab.onData,
        onPtyReady: (ptyId: number) => handlePtyReady(tab.id, ptyId),
      });
    }
    for (const id of liveTabIds) {
      if (!nextIds.has(id)) destroyTerminalTab(id);
    }
    liveTabIds = nextIds;
  });

  // The single placement pass — moves each tab's host to the pane, its tile,
  // or the parking root. See `terminal-registry.svelte.ts`.
  $effect(() => {
    placeTerminals($tabs.map((t) => t.id), showing, visibleTabId);
  });
</script>

<div class="terminal-panes">
  <div class="pane-slot" bind:this={paneEl}></div>
  {#if !$tabs.some((t) => t.id === visibleTabId)}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">terminal</span>
      <p class="empty-text">No session open — start one with {$chords.newSession}</p>
    </div>
  {/if}
</div>

<style>
  .terminal-panes {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--term-bg);
  }

  .pane-slot {
    position: absolute;
    inset: 0;
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    opacity: 0.5;
  }

  .empty-icon {
    font-size: 2.5rem !important;
    color: var(--muted);
  }

  .empty-text {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }
</style>
