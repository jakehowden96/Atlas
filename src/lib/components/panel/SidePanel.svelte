<script lang="ts">
  import DiffViewer from "./DiffViewer.svelte";
  import SummaryView from "./SummaryView.svelte";
  import CSSFlowDiagram from "./CSSFlowDiagram.svelte";
  import { panelData, activeSection, setSection, togglePanel } from "../../stores/panel";
  import type { PanelSection } from "../../../types/panel";

  const navItems: { id: PanelSection; label: string; icon: string }[] = [
    { id: "diff", label: "Diff", icon: "difference" },
    { id: "summary", label: "Summary", icon: "description" },
    { id: "flow", label: "Flow", icon: "account_tree" },
  ];
</script>

<div class="side-panel">
  <div class="panel-chrome">
    <div class="panel-spacer"></div>
    <div class="panel-tabs">
      <div class="tabs-left">
        {#each navItems as item (item.id)}
          <button
            class="panel-tab"
            class:active={$activeSection === item.id}
            onclick={() => setSection(item.id)}
          >
            <span class="material-symbols-outlined tab-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        {/each}
      </div>
      <div class="tabs-right">
        <button class="panel-close-btn" onclick={togglePanel} title="Close Panel">
          <span class="material-symbols-outlined">right_panel_close</span>
        </button>
      </div>
    </div>
  </div>
  <div class="panel-content">
    {#if $activeSection === "diff"}
      <DiffViewer data={$panelData?.diff} cwd={$panelData?.cwd ?? ''} />
    {:else if $activeSection === "summary"}
      <SummaryView data={$panelData?.summary} hasDiff={!!$panelData?.diff} />
    {:else if $activeSection === "flow"}
      <CSSFlowDiagram data={$panelData?.flow} hasDiff={!!$panelData?.diff} />
    {/if}
  </div>

</div>

<style>
  .side-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-container-low);
  }

  .panel-chrome {
    display: flex;
    flex-direction: column;
    height: var(--chrome-height);
    background: var(--surface-container-low);
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .panel-spacer {
    flex: 1;
  }

  .panel-tabs {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--tab-bar-height);
    padding: 0 0.25rem 0 0.5rem;
    flex-shrink: 0;
  }

  .tabs-left {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tabs-right {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .panel-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-size: 11px;
    font-family: var(--font-body);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .panel-tab:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .panel-tab.active {
    background: var(--surface-container-high);
    color: var(--on-surface);
    font-weight: 500;
  }

  .tab-icon {
    font-size: 0.9rem;
  }

  .panel-close-btn {
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
    padding: 0;
    transition: background 0.15s, color 0.15s;
  }

  .panel-close-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .panel-close-btn :global(.material-symbols-outlined) {
    font-size: 1rem;
  }

  .panel-content {
    flex: 1;
    overflow: auto;
    min-width: 0;
  }
</style>
