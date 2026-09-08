<script lang="ts">
  import { getSessionDir } from "../../ipc";
  import { activeTabId, tabs } from "../../stores/terminal";
  import { showToast } from "../../stores/toast";
  import TerminalTab from "./TerminalTab.svelte";

  async function handlePtyReady(tabId: string, ptyId: number) {
    tabs.update((t) => t.map((tab) => (tab.id === tabId ? { ...tab, ptyId } : tab)));
    try {
      await getSessionDir(tabId);
    } catch (e) {
      showToast(`Failed to create session directory: ${e}`);
    }
  }
</script>

<div class="terminal-area">
  <div class="terminal-panes">
    {#each $tabs as tab (tab.id)}
      <TerminalTab
        tabId={tab.id}
        visible={tab.id === $activeTabId}
        ready={tab.ready !== false}
        cwd={tab.cwd}
        onData={tab.onData}
        onPtyReady={(ptyId) => handlePtyReady(tab.id, ptyId)}
      />
    {/each}
    {#if !$activeTabId}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon">terminal</span>
        <p class="empty-text">No session open — start one with ⌘N</p>
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
    font-size: 12.5px;
  }
</style>
