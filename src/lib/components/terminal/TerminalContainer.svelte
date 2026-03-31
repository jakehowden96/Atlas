<script lang="ts">
  import { Terminal } from "@xterm/xterm";
  import TabBar from "./TabBar.svelte";
  import TerminalTab from "./TerminalTab.svelte";
  import {
    tabs,
    activeTabId,
    addTab,
    removeTab,
  } from "../../stores/terminal";
  import { ptyKill, getSessionDir } from "../../ipc";
  import type { TerminalTab as TabType } from "../../../types/terminal";

  let tabList: TabType[] = $state([]);
  let activeId: string = $state("");

  tabs.subscribe((v) => (tabList = v));
  activeTabId.subscribe((v) => (activeId = v));

  function createTab() {
    const id = crypto.randomUUID();
    const terminal = new Terminal(); // Placeholder, real one created in TerminalTab
    addTab({
      id,
      title: "",
      ptyId: -1,
      terminal,
    });
  }

  async function closeTab(id: string) {
    const tab = tabList.find((t) => t.id === id);
    if (tab && tab.ptyId >= 0) {
      await ptyKill(tab.ptyId);
    }
    removeTab(id);
    if (tabList.length === 0) {
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
    // Ensure session directory exists so the hook can write panel.json
    await getSessionDir(tabId);
  }

  // Create initial tab
  import { onMount } from "svelte";
  onMount(() => {
    if (tabList.length === 0) {
      createTab();
    }
  });

  // Handle Ctrl+T and Ctrl+W at window level
  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && !e.shiftKey && e.key === "t") {
      e.preventDefault();
      createTab();
    }
    if (e.ctrlKey && !e.shiftKey && e.key === "w") {
      e.preventDefault();
      if (activeId) {
        closeTab(activeId);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="terminal-area">
  <TabBar onNewTab={createTab} onCloseTab={closeTab} onSelectTab={selectTab} />
  <div class="terminal-panes">
    {#each tabList as tab (tab.id)}
      <TerminalTab
        tabId={tab.id}
        visible={tab.id === activeId}
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
  }

  .terminal-panes {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #1a1b26;
  }
</style>
