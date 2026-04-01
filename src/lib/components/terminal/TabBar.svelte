<script lang="ts">
  import { tabs, activeTabId } from "../../stores/terminal";
  import type { TabItem } from "../../../types/terminal";

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
        class:tab-markdown={tab.type === "markdown"}
        onclick={() => onSelectTab(tab.id)}
        title="Ctrl+{i + 1}"
      >
        {#if tab.type === "markdown"}
          <span class="material-symbols-outlined tab-type-icon">description</span>
        {/if}
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
    <span class="material-symbols-outlined">add</span>
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 4px;
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
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-size: 11px;
    font-family: var(--font-mono);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }

  .tab:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .tab.active {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .tab-markdown {
    color: var(--yellow);
  }

  .tab-markdown:hover {
    color: var(--yellow);
  }

  .tab-markdown.active {
    color: var(--yellow);
    background: color-mix(in srgb, var(--yellow) 10%, var(--surface-container-high));
  }

  .tab-type-icon {
    font-size: 0.8rem;
    font-variation-settings: 'FILL' 1;
  }

  .tab-title {
    max-width: 120px;
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
    color: var(--on-surface-variant);
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    padding: 0;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
    opacity: 0;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .new-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }

  .new-tab :global(.material-symbols-outlined) {
    font-size: 0.9rem;
  }

  .new-tab:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }
</style>
