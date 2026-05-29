<script lang="ts">
  import { get } from "svelte/store";
  import TerminalTab from "./TerminalTab.svelte";
  import FileTabView from "./FileTabView.svelte";
  import {
    tabs,
    activeTabId,
    removeTab,
  } from "../../stores/terminal";
  import { ptyKill, getSessionDir } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import { handleGlobalKeydown } from "../../shortcuts";

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

  function handleKeydown(e: KeyboardEvent) {
    if (handleGlobalKeydown(e)) return;
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
      {:else if tab.type === "file"}
        <FileTabView
          {tab}
          visible={tab.id === $activeTabId}
        />
      {/if}
    {/each}
    {#if !$activeTabId}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon">terminal</span>
        <p class="empty-text">Create a session from a workspace to get started</p>
      </div>
    {/if}
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

  .terminal-panes {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--surface);
  }

  .empty-state {
    position: absolute;
    inset: 0;
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
