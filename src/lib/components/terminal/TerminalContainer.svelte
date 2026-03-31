<script lang="ts">
  import { Terminal } from "@xterm/xterm";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import TabBar from "./TabBar.svelte";
  import TerminalTab from "./TerminalTab.svelte";
  import {
    tabs,
    activeTabId,
    addTab,
    removeTab,
  } from "../../stores/terminal";
  import { ptyKill, getSessionDir } from "../../ipc";
  import { showToast } from "../../stores/toast";

  function createTab() {
    const id = crypto.randomUUID();
    const terminal = new Terminal();
    addTab({
      id,
      title: "",
      ptyId: -1,
      terminal,
    });
  }

  async function closeTab(id: string) {
    const tabList = get(tabs);
    const tab = tabList.find((t) => t.id === id);
    if (tab && tab.ptyId >= 0) {
      try {
        await ptyKill(tab.ptyId);
      } catch (e) {
        showToast(`Failed to kill terminal: ${e}`);
      }
    }
    removeTab(id);
    if (get(tabs).length === 0) {
      createTab();
    }
  }

  function selectTab(id: string) {
    activeTabId.set(id);
  }

  async function handlePtyReady(tabId: string, ptyId: number) {
    tabs.update((t) =>
      t.map((tab) => (tab.id === tabId ? { ...tab, ptyId } : tab)),
    );
    try {
      await getSessionDir(tabId);
    } catch (e) {
      showToast(`Failed to create session directory: ${e}`);
    }
  }

  onMount(() => {
    if (get(tabs).length === 0) {
      createTab();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && !e.shiftKey && e.key === "t") {
      e.preventDefault();
      createTab();
    }
    if (e.ctrlKey && !e.shiftKey && e.key === "w") {
      e.preventDefault();
      const activeId = get(activeTabId);
      if (activeId) {
        closeTab(activeId);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="terminal-area">
  <div class="terminal-chrome">
    <div class="chrome-left">
      <div class="window-dots">
        <span class="dot dot-red"></span>
        <span class="dot dot-yellow"></span>
        <span class="dot dot-green"></span>
      </div>
      <span class="session-label">zsh — forge</span>
    </div>
    <div class="chrome-tabs">
      <TabBar onNewTab={createTab} onCloseTab={closeTab} onSelectTab={selectTab} />
    </div>
  </div>
  <div class="terminal-panes">
    {#each $tabs as tab (tab.id)}
      <TerminalTab
        tabId={tab.id}
        visible={tab.id === $activeTabId}
        onPtyReady={(ptyId) => handlePtyReady(tab.id, ptyId)}
      />
    {/each}
  </div>
</div>

<style>
  .terminal-area {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--surface);
  }

  .terminal-chrome {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 1rem;
    height: 40px;
    background: var(--surface-container-low);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .chrome-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .window-dots {
    display: flex;
    gap: 6px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .dot-red {
    background: color-mix(in srgb, var(--error) 40%, transparent);
  }

  .dot-yellow {
    background: color-mix(in srgb, var(--tertiary) 40%, transparent);
  }

  .dot-green {
    background: color-mix(in srgb, var(--secondary) 40%, transparent);
  }

  .session-label {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .chrome-tabs {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .terminal-panes {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--surface-container-lowest);
  }
</style>
