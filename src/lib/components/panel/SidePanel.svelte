<script lang="ts">
  import DiffViewer from "./DiffViewer.svelte";
  import SummaryView from "./SummaryView.svelte";
  import FlowDiagram from "./FlowDiagram.svelte";
  import { panelData, activeSection } from "../../stores/panel";
</script>

<div class="side-panel">
  <div class="panel-content">
    {#if $activeSection === "diff"}
      <DiffViewer data={$panelData?.diff} cwd={$panelData?.cwd ?? ''} />
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
    background: var(--surface-container-low);
  }

  .panel-content {
    flex: 1;
    overflow: hidden;
  }
</style>
