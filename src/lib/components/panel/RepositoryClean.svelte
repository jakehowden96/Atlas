<script lang="ts">
  import { onMount } from "svelte";
  import { panelData } from "../../stores/panel";
  import { activeTabId } from "../../stores/terminal";
  import { getGitStatus, refreshPanel } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import { get } from "svelte/store";
  import type { GitStatus } from "../../../types/panel";

  let status: GitStatus | null = $state(null);
  let checking = $state(false);

  let cwd = $derived($panelData?.cwd ?? "");
  let projectName = $derived(cwd.split("/").pop() ?? "workspace");

  onMount(() => {
    fetchStatus();
  });

  async function fetchStatus() {
    if (!cwd) return;
    try {
      status = await getGitStatus(cwd);
    } catch {
      status = null;
    }
  }

  async function handleCheckForUpdates() {
    if (!cwd) return;
    checking = true;
    try {
      await refreshPanel(get(activeTabId), cwd);
      await fetchStatus();
      showToast("Already up to date");
    } catch (e) {
      showToast(`Check failed: ${e}`);
    } finally {
      checking = false;
    }
  }
</script>

<div class="clean-state">
  <div class="clean-icon-wrapper">
    <span class="material-symbols-outlined clean-icon">check_circle</span>
  </div>

  <h2 class="clean-title">Repository Clean</h2>
  <p class="clean-subtitle">
    No local changes detected in <code class="project-code">{projectName}</code>. Your workspace is perfectly synchronized with the remote head.
  </p>

  <div class="info-row">
    <div class="info-pill">
      <span class="info-label">Active Branch</span>
      <span class="info-value">
        <span class="material-symbols-outlined info-icon">fork_right</span>
        {status?.branch ?? "..."}
      </span>
    </div>
    <div class="info-pill">
      <span class="info-label">Sync Status</span>
      <span class="info-value synced">
        <span class="material-symbols-outlined info-icon">cloud_done</span>
        Up to date
      </span>
    </div>
  </div>

  <button
    class="check-btn"
    onclick={handleCheckForUpdates}
    disabled={checking}
  >
    {checking ? "Checking..." : "Check for Updates"}
  </button>
</div>

<style>
  .clean-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    text-align: center;
    gap: 0.75rem;
  }

  .clean-icon-wrapper {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--secondary) 12%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 0.5rem;
  }

  .clean-icon {
    font-size: 1.75rem;
    color: var(--secondary);
    font-variation-settings: 'FILL' 1;
  }

  .clean-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--on-surface);
    letter-spacing: -0.02em;
  }

  .clean-subtitle {
    margin: 0;
    font-size: 0.8rem;
    font-family: var(--font-body);
    color: var(--on-surface-variant);
    line-height: 1.55;
    max-width: 320px;
  }

  .project-code {
    padding: 1px 6px;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--primary);
  }

  .info-row {
    display: flex;
    gap: 1.5rem;
    margin-top: 0.75rem;
  }

  .info-pill {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: flex-start;
  }

  .info-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-surface-variant);
  }

  .info-value {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--on-surface);
  }

  .info-value.synced {
    color: var(--secondary);
  }

  .info-icon {
    font-size: 0.9rem;
  }

  .check-btn {
    margin-top: 1rem;
    padding: 0.6rem 1.5rem;
    background: var(--surface-container-high);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    border-radius: 8px;
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .check-btn:hover:not(:disabled) {
    background: var(--surface-container-highest);
    border-color: color-mix(in srgb, var(--outline-variant) 50%, transparent);
  }

  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
