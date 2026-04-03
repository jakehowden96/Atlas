<script lang="ts">
  import { Terminal } from "@xterm/xterm";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import TabBar from "./TabBar.svelte";
  import TerminalTab from "./TerminalTab.svelte";
  import MarkdownTabView from "./MarkdownTab.svelte";
  import {
    tabs,
    activeTabId,
    addTab,
    removeTab,
  } from "../../stores/terminal";
  import { ptyKill, getSessionDir } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import { handleGlobalKeydown } from "../../shortcuts";

  function createTab() {
    const id = crypto.randomUUID();
    const terminal = new Terminal();
    addTab({
      type: "terminal",
      id,
      title: "",
      ptyId: -1,
      terminal,
    });
  }

  async function closeTab(id: string) {
    const tabList = get(tabs);
    const tab = tabList.find((t) => t.id === id);
    if (tab && tab.type === "terminal" && tab.ptyId >= 0) {
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
      t.map((tab) => (tab.id === tabId && tab.type === "terminal" ? { ...tab, ptyId } : tab)),
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
    if (handleGlobalKeydown(e)) return;
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
    <TabBar onNewTab={createTab} onCloseTab={closeTab} onSelectTab={selectTab} />
  </div>
  <div class="terminal-panes">
    {#each $tabs as tab (tab.id)}
      {#if tab.type === "terminal"}
        <TerminalTab
          tabId={tab.id}
          visible={tab.id === $activeTabId}
          onPtyReady={(ptyId) => handlePtyReady(tab.id, ptyId)}
        />
      {:else if tab.type === "markdown"}
        <MarkdownTabView
          {tab}
          visible={tab.id === $activeTabId}
        />
      {/if}
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
    padding: 0 0.5rem;
    height: 36px;
    background: var(--surface-container-low);
    border-bottom: 1px solid var(--outline-variant);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .terminal-panes {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--surface);
  }
</style>
