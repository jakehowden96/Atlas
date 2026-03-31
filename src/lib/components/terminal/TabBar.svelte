<script lang="ts">
  import { tabs, activeTabId } from "../../stores/terminal";
  import type { TerminalTab } from "../../../types/terminal";

  interface Props {
    onNewTab: () => void;
    onCloseTab: (id: string) => void;
    onSelectTab: (id: string) => void;
  }

  let { onNewTab, onCloseTab, onSelectTab }: Props = $props();

  let tabList: TerminalTab[] = $state([]);
  let activeId: string = $state("");

  tabs.subscribe((v) => (tabList = v));
  activeTabId.subscribe((v) => (activeId = v));
</script>

<div class="tab-bar">
  <div class="tabs">
    {#each tabList as tab, i}
      <button
        class="tab"
        class:active={tab.id === activeId}
        onclick={() => onSelectTab(tab.id)}
        title="Ctrl+{i + 1}"
      >
        <span class="tab-index">{i + 1}</span>
        <span class="tab-title">{tab.title || `Tab ${i + 1}`}</span>
        {#if tabList.length > 1}
          <button
            class="tab-close"
            onclick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            title="Close"
          >
            &times;
          </button>
        {/if}
      </button>
    {/each}
  </div>
  <button class="new-tab" onclick={onNewTab} title="New Tab (Ctrl+T)">
    +
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    background: #13141c;
    border-bottom: 1px solid #292d3e;
    height: 36px;
    padding: 0 4px;
    user-select: none;
    -webkit-user-select: none;
  }

  .tabs {
    display: flex;
    flex: 1;
    overflow-x: auto;
    gap: 2px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: transparent;
    border: none;
    border-radius: 6px 6px 0 0;
    color: #787c99;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
  }

  .tab:hover {
    background: #1e2030;
    color: #a9b1d6;
  }

  .tab.active {
    background: #1a1b26;
    color: #c0caf5;
  }

  .tab-index {
    font-size: 10px;
    opacity: 0.5;
    font-weight: 600;
  }

  .tab-title {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: none;
    border: none;
    color: #787c99;
    font-size: 14px;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    line-height: 1;
  }

  .tab-close:hover {
    background: #f7768e33;
    color: #f7768e;
  }

  .new-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    color: #787c99;
    font-size: 18px;
    cursor: pointer;
    border-radius: 4px;
    margin-left: 4px;
  }

  .new-tab:hover {
    background: #1e2030;
    color: #a9b1d6;
  }
</style>
