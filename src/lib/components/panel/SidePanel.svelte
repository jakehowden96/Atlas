<script lang="ts">
  import DiffViewer from "./DiffViewer.svelte";
  import SummaryView from "./SummaryView.svelte";
  import FlowDiagram from "./FlowDiagram.svelte";
  import { panelData, activeSection, setSection } from "../../stores/panel";
  import type { PanelData, PanelSection } from "../../../types/panel";

  const sections: { id: PanelSection; label: string; shortcut: string }[] = [
    { id: "diff", label: "Diff", shortcut: "D" },
    { id: "summary", label: "Summary", shortcut: "S" },
    { id: "flow", label: "Flow", shortcut: "F" },
  ];

  let data: PanelData | null = $state(null);
  let currentSection: PanelSection = $state("diff");

  panelData.subscribe((v) => (data = v));
  activeSection.subscribe((v) => (currentSection = v));
</script>

<div class="side-panel">
  <div class="panel-header">
    <div class="panel-tabs">
      {#each sections as section}
        <button
          class="panel-tab"
          class:active={currentSection === section.id}
          onclick={() => setSection(section.id)}
          title="Ctrl+Shift+{section.shortcut}"
        >
          {section.label}
        </button>
      {/each}
    </div>
    {#if data}
      <span class="panel-timestamp">
        {new Date(data.timestamp).toLocaleTimeString()}
      </span>
    {/if}
  </div>

  <div class="panel-content">
    {#if currentSection === "diff"}
      <DiffViewer data={data?.diff} />
    {:else if currentSection === "summary"}
      <SummaryView data={data?.summary} />
    {:else if currentSection === "flow"}
      <FlowDiagram data={data?.flow} />
    {/if}
  </div>
</div>

<style>
  .side-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1a1b26;
    border-left: 1px solid #292d3e;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    height: 36px;
    background: #13141c;
    border-bottom: 1px solid #292d3e;
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
    color: #787c99;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .panel-tab:hover {
    background: #1e2030;
    color: #a9b1d6;
  }

  .panel-tab.active {
    background: #1e2030;
    color: #c0caf5;
  }

  .panel-timestamp {
    font-size: 11px;
    color: #444b6a;
  }

  .panel-content {
    flex: 1;
    overflow: hidden;
  }
</style>
