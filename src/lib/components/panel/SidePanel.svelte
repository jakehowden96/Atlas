<script lang="ts">
  import DiffViewer from "./DiffViewer.svelte";
  import SummaryView from "./SummaryView.svelte";
  import FlowDiagram from "./FlowDiagram.svelte";
  import { panelData, activeSection, setSection } from "../../stores/panel";
  import type { PanelSection } from "../../../types/panel";

  const sections: { id: PanelSection; label: string; shortcut: string }[] = [
    { id: "diff", label: "Diff", shortcut: "D" },
    { id: "summary", label: "Summary", shortcut: "S" },
    { id: "flow", label: "Flow", shortcut: "F" },
  ];
</script>

<div class="side-panel">
  <div class="panel-header">
    <div class="panel-tabs">
      {#each sections as section}
        <button
          class="panel-tab"
          class:active={$activeSection === section.id}
          onclick={() => setSection(section.id)}
          title="Ctrl+Shift+{section.shortcut}"
        >
          {section.label}
        </button>
      {/each}
    </div>
    {#if $panelData}
      <span class="panel-timestamp">
        {new Date($panelData.timestamp).toLocaleTimeString()}
      </span>
    {/if}
  </div>

  <div class="panel-content">
    {#if $activeSection === "diff"}
      <DiffViewer data={$panelData?.diff} />
    {:else if $activeSection === "summary"}
      <SummaryView data={$panelData?.summary} hasDiff={!!$panelData?.diff} />
    {:else if $activeSection === "flow"}
      <FlowDiagram data={$panelData?.flow} hasDiff={!!$panelData?.diff} />
    {/if}
  </div>
</div>

<style>
  .side-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    border-left: 1px solid var(--border);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    height: 36px;
    background: var(--bg-dark);
    border-bottom: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }

  .panel-tabs {
    display: flex;
    gap: 2px;
  }

  .panel-tab {
    padding: 4px 12px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--fg-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .panel-tab:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .panel-tab.active {
    background: var(--bg-light);
    color: var(--fg-bright);
  }

  .panel-timestamp {
    font-size: 11px;
    color: var(--fg-dim);
  }

  .panel-content {
    flex: 1;
    overflow: hidden;
  }
</style>
