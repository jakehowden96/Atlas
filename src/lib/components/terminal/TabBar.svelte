<script lang="ts">
  import { tabs, activeTabId } from "../../stores/terminal";

  interface Props {
    onNewTab: () => void;
    onCloseTab: (id: string) => void;
    onSelectTab: (id: string) => void;
  }

  let { onNewTab, onCloseTab, onSelectTab }: Props = $props();
</script>

<div class="tab-bar">
  <div class="tabs">
    {#each $tabs as tab, i}
      <button
        class="tab"
        class:active={tab.id === $activeTabId}
        onclick={() => onSelectTab(tab.id)}
        title="Ctrl+{i + 1}"
      >
        <span class="tab-index">{i + 1}</span>
        <span class="tab-title">{tab.title || `Tab ${i + 1}`}</span>
        {#if $tabs.length > 1}
          <span
            class="tab-close"
            role="button"
            tabindex="-1"
            onclick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            onkeydown={() => {}}
            title="Close"
          >
            &times;
          </span>
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
    background: var(--bg-dark);
    border-bottom: 1px solid var(--border);
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
    color: var(--fg-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
  }

  .tab:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .tab.active {
    background: var(--bg);
    color: var(--fg-bright);
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
    color: var(--fg-muted);
    font-size: 14px;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    line-height: 1;
  }

  .tab-close:hover {
    background: color-mix(in srgb, var(--red) 20%, transparent);
    color: var(--red);
  }

  .new-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 18px;
    cursor: pointer;
    border-radius: 4px;
    margin-left: 4px;
  }

  .new-tab:hover {
    background: var(--bg-light);
    color: var(--fg);
  }
</style>
