<script lang="ts">
  import DiffViewer from "./DiffViewer.svelte";
  import { panelData, togglePanel } from "../../stores/panel";
</script>

<div class="side-panel">
  <div class="panel-chrome">
    <div class="panel-spacer"></div>
    <div class="panel-row">
      <span class="panel-title">Diff</span>
      <button class="panel-close-btn" onclick={togglePanel} title="Close Panel">
        <span class="material-symbols-outlined">right_panel_close</span>
      </button>
    </div>
  </div>
  <div class="panel-content">
    <DiffViewer data={$panelData?.diff} cwd={$panelData?.cwd ?? ''} />
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

  .panel-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--tab-bar-height);
    padding: 0 0.25rem 0 0.75rem;
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-display);
    color: var(--on-surface);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.85;
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
