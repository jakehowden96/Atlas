<script lang="ts">
  import DiffViewer from "./DiffViewer.svelte";
  import { panelData, togglePanel } from "../../stores/panel";

  let diff = $derived($panelData?.diff);
  let statusLabel = $derived.by(() => {
    if (!diff) return "No changes";
    const fileWord = diff.files_changed === 1 ? "file" : "files";
    return `${diff.files_changed} ${fileWord} +${diff.lines_added} -${diff.lines_removed}`;
  });
</script>

<div class="side-panel">
  <div class="panel-chrome">
    <div class="panel-spacer"></div>
    <div class="panel-bar">
      <span class="status-pill">{statusLabel}</span>
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

  .panel-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--tab-bar-height);
    padding: 0 0.25rem 0 0.5rem;
    flex-shrink: 0;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-container-high);
    color: var(--on-surface-variant);
    font-size: 11px;
    font-family: var(--font-mono);
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
