<script lang="ts">
  import { Terminal } from "@xterm/xterm";
  import { get } from "svelte/store";
  import TabBar from "./TabBar.svelte";
  import TerminalTab from "./TerminalTab.svelte";
  import MarkdownTabView from "./MarkdownTab.svelte";
  import {
    tabs,
    activeTabId,
    addTab,
    removeTab,
    getTabWorkspacePath,
    chromeHeight as chromeHeightStore,
    tabBarHeight as tabBarHeightStore,
  } from "../../stores/terminal";
  import { activeWorkspacePath } from "../../stores/workspace";
  import { ptyKill, getSessionDir } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import { handleGlobalKeydown } from "../../shortcuts";

  function createTab() {
    const id = crypto.randomUUID();
    const terminal = new Terminal();
    const wsPath = get(activeWorkspacePath);
    addTab({
      type: "terminal",
      id,
      title: "",
      ptyId: -1,
      terminal,
      cwd: wsPath || undefined,
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
  }

  async function closeGroup(cwd: string) {
    const tabList = get(tabs);
    const toClose = tabList.filter((t) => {
      return getTabWorkspacePath(t) === cwd;
    });
    for (const tab of toClose) {
      if (tab.type === "terminal" && tab.ptyId >= 0) {
        try {
          await ptyKill(tab.ptyId);
        } catch (e) {
          showToast(`Failed to kill terminal: ${e}`);
        }
      }
      removeTab(tab.id);
    }
  }

  function selectTab(id: string) {
    activeTabId.set(id);
  }

  function selectWorkspace(path: string) {
    // Tab restoration is handled by the activeWorkspacePath subscriber in the terminal store
    activeWorkspacePath.set(path);
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

  let measuredChromeHeight = $state(0);
  let measuredTabBarHeight = $state(0);

  $effect(() => {
    if (measuredChromeHeight > 0) chromeHeightStore.set(measuredChromeHeight);
  });

  $effect(() => {
    if (measuredTabBarHeight > 0) tabBarHeightStore.set(measuredTabBarHeight);
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
  {#if $tabs.length > 0}
    <div class="terminal-chrome" bind:clientHeight={measuredChromeHeight}>
      <TabBar
        onCloseTab={closeTab}
        onSelectTab={selectTab}
        onCloseGroup={closeGroup}
        onSelectWorkspace={selectWorkspace}
        bind:tabBarRowHeight={measuredTabBarHeight}
      />
    </div>
    <div class="terminal-panes">
      {#each $tabs as tab (tab.id)}
        {#if tab.type === "terminal"}
          <TerminalTab
            tabId={tab.id}
            visible={tab.id === $activeTabId}
            ready={tab.ready !== false}
            cwd={tab.cwd}
            onData={tab.onData}
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
  {:else}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">terminal</span>
      <p class="empty-text">Create a session from a workspace to get started</p>
    </div>
  {/if}
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
    align-items: stretch;
    background: var(--surface-container-low);
    flex-shrink: 0;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }

  .terminal-panes {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--surface);
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    opacity: 0.4;
  }

  .empty-icon {
    font-size: 2.5rem !important;
    color: var(--on-surface-variant);
  }

  .empty-text {
    font-size: 0.8rem;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    margin: 0;
  }
</style>
