<script lang="ts">
  import { onMount } from "svelte";
  import type { DiffData } from "../../../types/panel";
  import type { GitStatus } from "../../../types/panel";
  import { gitStageAll, gitDiscardAll, getGitStatus, gitCommit, gitPush } from "../../ipc";
  import { panelData } from "../../stores/panel";
  import { showToast } from "../../stores/toast";

  interface Props {
    data: DiffData;
    cwd: string;
  }

  let { data, cwd }: Props = $props();
  let status: GitStatus | null = $state(null);
  let loading = $state(false);
  let commitMsg = $state("");
  let commitMsgInitialized = false;

  // Derive which action phase we're in
  let phase = $derived.by(() => {
    if (!status) return "loading" as const;
    if (status.has_unstaged) return "stage" as const;
    if (status.has_staged) return "commit" as const;
    if (status.has_unpushed) return "push" as const;
    return "clean" as const;
  });

  // Pre-fill commit message from AI summary when entering commit phase
  $effect(() => {
    if (phase === "commit" && !commitMsgInitialized) {
      const summary = $panelData?.summary?.summary;
      if (summary) {
        commitMsg = summary;
      }
      commitMsgInitialized = true;
    }
    if (phase !== "commit") {
      commitMsgInitialized = false;
    }
  });

  async function refreshStatus() {
    try {
      status = await getGitStatus(cwd);
    } catch {
      status = null;
    }
  }

  onMount(() => {
    refreshStatus();
  });

  async function handleStage() {
    loading = true;
    try {
      await gitStageAll(cwd);
      showToast("Changes staged");
      await refreshStatus();
    } catch (e: unknown) {
      showToast(`Stage failed: ${e}`, "error");
    } finally {
      loading = false;
    }
  }

  async function handleCommit() {
    if (!commitMsg.trim()) {
      showToast("Commit message required", "error");
      return;
    }
    loading = true;
    try {
      await gitCommit(cwd, commitMsg.trim());
      showToast("Changes committed");
      commitMsg = "";
      await refreshStatus();
    } catch (e: unknown) {
      showToast(`Commit failed: ${e}`, "error");
    } finally {
      loading = false;
    }
  }

  async function handlePush() {
    loading = true;
    try {
      await gitPush(cwd);
      showToast("Pushed to remote");
      await refreshStatus();
    } catch (e: unknown) {
      showToast(`Push failed: ${e}`, "error");
    } finally {
      loading = false;
    }
  }

  async function handleDiscard() {
    loading = true;
    try {
      await gitDiscardAll(cwd);
      showToast("Changes discarded", "warning");
      await refreshStatus();
    } catch (e: unknown) {
      showToast(`Discard failed: ${e}`, "error");
    } finally {
      loading = false;
    }
  }
</script>

<div class="change-summary">
  <div class="summary-header">
    <h3 class="summary-title">Change Summary</h3>
    {#if status?.branch}
      <span class="branch-badge">
        <span class="material-symbols-outlined branch-icon">fork_right</span>
        {status.branch}
      </span>
    {:else}
      <span class="code-icon">&lt;&gt;</span>
    {/if}
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

  {#if phase === "commit"}
    <div class="commit-section">
      <div class="commit-label-row">
        <span class="commit-label">COMMIT MESSAGE</span>
        {#if $panelData?.summary?.summary && commitMsg === $panelData.summary.summary}
          <span class="ai-badge">AI</span>
        {/if}
      </div>
      <textarea
        class="commit-input"
        bind:value={commitMsg}
        placeholder="Describe your changes..."
        rows="3"
        disabled={loading}
      ></textarea>
    </div>
  {/if}

  <div class="actions">
    {#if phase === "stage"}
      <button
        class="btn btn-stage"
        onclick={handleStage}
        disabled={loading}
      >
        {loading ? "STAGING..." : "STAGE CHANGES"}
      </button>
    {:else if phase === "commit"}
      <button
        class="btn btn-commit"
        onclick={handleCommit}
        disabled={loading || !commitMsg.trim()}
      >
        {loading ? "COMMITTING..." : "COMMIT"}
      </button>
    {:else if phase === "push"}
      <button
        class="btn btn-push"
        onclick={handlePush}
        disabled={loading}
      >
        {loading ? "PUSHING..." : "PUSH"}
      </button>
    {:else if phase === "clean"}
      <button class="btn btn-clean" disabled>
        UP TO DATE
      </button>
    {:else}
      <button class="btn btn-stage" disabled title="Loading">
        <span class="loading-dot"></span>
      </button>
    {/if}

    {#if phase !== "clean" && phase !== "push" && phase !== "loading"}
      <button
        class="btn btn-discard"
        onclick={handleDiscard}
        disabled={loading}
      >
        {loading ? "..." : "DISCARD ALL"}
      </button>
    {/if}
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

  .branch-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
    border-radius: 9999px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--primary);
  }

  .branch-icon {
    font-size: 14px;
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

  /* Commit message section */
  .commit-section {
    margin-bottom: 16px;
  }

  .commit-label-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .commit-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--on-surface-variant);
  }

  .ai-badge {
    padding: 1px 6px;
    background: color-mix(in srgb, var(--tertiary) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--tertiary) 30%, transparent);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    color: var(--tertiary);
    letter-spacing: 0.04em;
  }

  .commit-input {
    width: 100%;
    padding: 10px 12px;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
  }

  .commit-input:focus {
    border-color: var(--primary);
  }

  .commit-input::placeholder {
    color: var(--on-surface-variant);
    opacity: 0.5;
  }

  .commit-input:disabled {
    opacity: 0.5;
  }

  /* Actions */
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
    display: flex;
    align-items: center;
    gap: 8px;
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

  .btn-commit {
    background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 20%, var(--surface-container-highest)), color-mix(in srgb, var(--primary) 30%, var(--surface-container-highest)));
    color: var(--primary);
  }

  .btn-commit:hover:not(:disabled) {
    background: color-mix(in srgb, var(--primary) 25%, var(--surface-container-highest));
  }

  .btn-push {
    background: linear-gradient(135deg, color-mix(in srgb, var(--tertiary) 20%, var(--surface-container-highest)), color-mix(in srgb, var(--tertiary) 30%, var(--surface-container-highest)));
    color: var(--tertiary);
  }

  .btn-push:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tertiary) 25%, var(--surface-container-highest));
  }

  .btn-clean {
    background: var(--surface-container-highest);
    color: var(--on-surface-variant);
  }

  .btn-discard {
    background: var(--surface-container-highest);
    color: var(--on-surface-variant);
  }

  .btn-discard:hover:not(:disabled) {
    background: var(--surface-bright);
    color: var(--on-surface);
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--on-surface-variant);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
</style>
