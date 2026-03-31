<script lang="ts">
  import type { DiffData } from "../../../types/panel";
  import { gitStageAll, gitDiscardAll } from "../../ipc";
  import { showToast } from "../../stores/toast";

  interface Props {
    data: DiffData;
    cwd: string;
  }

  let { data, cwd }: Props = $props();
  let staging = $state(false);
  let discarding = $state(false);

  async function handleStage() {
    staging = true;
    try {
      await gitStageAll(cwd);
      showToast("Changes staged", "info");
    } catch (e: unknown) {
      showToast(`Stage failed: ${e}`, "error");
    } finally {
      staging = false;
    }
  }

  async function handleDiscard() {
    discarding = true;
    try {
      await gitDiscardAll(cwd);
      showToast("Changes discarded", "warning");
    } catch (e: unknown) {
      showToast(`Discard failed: ${e}`, "error");
    } finally {
      discarding = false;
    }
  }
</script>

<div class="change-summary">
  <div class="summary-header">
    <h3 class="summary-title">Change Summary</h3>
    <span class="code-icon">&lt;&gt;</span>
  </div>

  <div class="stats-row">
    <div class="stat">
      <span class="stat-label">ADDITIONS</span>
      <span class="stat-value added">+{data.lines_added}</span>
    </div>
    <div class="stat">
      <span class="stat-label">DELETIONS</span>
      <span class="stat-value removed">-{data.lines_removed}</span>
    </div>
    <div class="stat">
      <span class="stat-label">FILES CHANGED</span>
      <span class="stat-value files">{data.files_changed}</span>
    </div>
  </div>

  <div class="actions">
    <button
      class="btn btn-stage"
      onclick={handleStage}
      disabled={staging || discarding}
    >
      {staging ? "STAGING..." : "STAGE CHANGES"}
    </button>
    <button
      class="btn btn-discard"
      onclick={handleDiscard}
      disabled={staging || discarding}
    >
      {discarding ? "DISCARDING..." : "DISCARD ALL"}
    </button>
  </div>
</div>

<style>
  .change-summary {
    background: var(--surface-container-high);
    border-radius: 12px;
    padding: 20px 24px;
    margin: 16px 10px 10px;
  }

  .summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .summary-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--on-surface);
    margin: 0;
  }

  .code-icon {
    font-family: var(--font-mono);
    font-size: 24px;
    color: var(--on-surface-variant);
    opacity: 0.5;
  }

  .stats-row {
    display: flex;
    gap: 32px;
    margin-bottom: 20px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--on-surface-variant);
    text-transform: uppercase;
  }

  .stat-value {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .stat-value.added {
    color: var(--secondary);
  }

  .stat-value.removed {
    color: var(--error);
  }

  .stat-value.files {
    color: var(--on-surface);
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-stage {
    background: linear-gradient(135deg, var(--secondary-container), color-mix(in srgb, var(--secondary-container) 80%, var(--secondary)));
    color: var(--secondary);
  }

  .btn-stage:hover:not(:disabled) {
    background: var(--secondary-container);
  }

  .btn-discard {
    background: var(--surface-container-highest);
    color: var(--on-surface-variant);
  }

  .btn-discard:hover:not(:disabled) {
    background: var(--surface-bright);
    color: var(--on-surface);
  }
</style>
