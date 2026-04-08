<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import type { DiffData, ProjectDiff } from "../../../types/panel";
  import type { GitStatus } from "../../../types/panel";
  import { gitStageAll, gitStageFiles, gitDiscardAll, getGitStatus, gitCommit, gitPush, refreshPanel } from "../../ipc";
  import { panelData } from "../../stores/panel";
  import { activeTabId } from "../../stores/terminal";
  import ActionButton from "./ActionButton.svelte";
  import BranchSwitcher from "./BranchSwitcher.svelte";

  interface Props {
    data: DiffData;
    cwd: string;
    projects?: ProjectDiff[];
    selectedFiles?: Set<string>;
  }

  let { data, cwd, projects, selectedFiles }: Props = $props();
  let status: GitStatus | null = $state(null);
  let loading = $state(false);
  let stageDone = $state(false);
  let commitDone = $state(false);
  let pushDone = $state(false);
  let transitioning = $state(false);

  const MIN_LOADING_MS = 600;

  /** Run an async operation with a minimum visible loading time. */
  async function withMinLoading<T>(fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const elapsed = Date.now() - start;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
    }
    return result;
  }

  let commitMsg = $state("");
  let commitMsgInitialized = false;
  let selectedProjectName: string | null = $state(null);
  let errorMsg: string | null = $state(null);

  let showDropdown = $derived(!!projects && projects.length > 1);
  let effectiveProject = $derived.by(() => {
    if (!projects || projects.length === 0) return null;
    if (projects.length === 1) return projects[0];
    return projects.find(p => p.name === selectedProjectName) ?? projects[0];
  });
  let effectiveCwd = $derived(
    effectiveProject ? `${cwd}/${effectiveProject.name}` : cwd
  );

  $effect(() => {
    if (projects && projects.length > 0 && !selectedProjectName) {
      selectedProjectName = projects[0].name;
    }
  });

  // Re-fetch git status when selected project or panelData changes
  // (panelData updates after git checkout in terminal triggers a refresh)
  $effect(() => {
    void effectiveCwd;
    void $panelData;
    refreshStatus();
  });

  // Derive which action phase we're in
  let phase = $derived.by(() => {
    if (!status) return "loading" as const;
    if (status.has_unstaged) return "stage" as const;
    if (status.has_staged) return "commit" as const;
    if (status.has_unpushed) return "push" as const;
    return "clean" as const;
  });

  // Visible phase lags behind the real phase so the done/fade animation
  // can finish before the next button appears.
  type Phase = "loading" | "stage" | "commit" | "push" | "clean";
  let visiblePhase = $state<Phase>("loading");
  let phaseTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const next = phase;
    if (next === visiblePhase) return;
    if (phaseTimer) clearTimeout(phaseTimer);
    // If we're in a done state, wait for the phase-out animation (500ms) to finish
    if (transitioning) {
      phaseTimer = setTimeout(() => {
        visiblePhase = next;
        transitioning = false;
      }, 550);
    } else {
      visiblePhase = next;
    }
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
      status = await getGitStatus(effectiveCwd);
    } catch {
      status = null;
    }
  }

  async function refreshPanelData() {
    const data = await refreshPanel(get(activeTabId), effectiveCwd);
    panelData.set(data);
  }

  onMount(() => {
    refreshStatus();
  });

  function clearError() {
    errorMsg = null;
  }

  function showError(msg: unknown) {
    errorMsg = typeof msg === "string" ? msg : (msg as Error)?.message ?? "Operation failed";
  }

  async function handleStage() {
    clearError();
    loading = true;
    stageDone = false;
    await tick();
    try {
      await withMinLoading(async () => {
        if (selectedFiles && selectedFiles.size > 0 && effectiveProject) {
          const prefix = effectiveProject.name + "/";
          const projectFiles = [...selectedFiles]
            .filter((f) => f.startsWith(prefix))
            .map((f) => f.slice(prefix.length));
          if (projectFiles.length > 0) {
            await gitStageFiles(effectiveCwd, projectFiles);
          } else {
            await gitStageAll(effectiveCwd);
          }
        } else if (selectedFiles && selectedFiles.size > 0) {
          await gitStageFiles(effectiveCwd, [...selectedFiles]);
        } else {
          await gitStageAll(effectiveCwd);
        }
      });
      loading = false;
      stageDone = true;
      transitioning = true;
      await refreshStatus();
      await refreshPanelData();
    } catch (e) {
      showError(e);
      loading = false;
    }
  }

  async function handleCommit() {
    if (!commitMsg.trim()) return;
    clearError();
    loading = true;
    commitDone = false;
    await tick();
    try {
      await withMinLoading(() => gitCommit(effectiveCwd, commitMsg.trim()));
      commitMsg = "";
      loading = false;
      commitDone = true;
      transitioning = true;
      await refreshStatus();
      await refreshPanelData();
    } catch (e) {
      showError(e);
      loading = false;
    }
  }

  async function handlePush() {
    clearError();
    loading = true;
    pushDone = false;
    await tick();
    try {
      await withMinLoading(() => gitPush(effectiveCwd));
      loading = false;
      pushDone = true;
      transitioning = true;
      await refreshStatus();
      await refreshPanelData();
    } catch (e) {
      showError(e);
      loading = false;
    }
  }

  async function handleDiscard() {
    clearError();
    loading = true;
    await tick();
    try {
      await gitDiscardAll(effectiveCwd);
      await refreshStatus();
      await refreshPanelData();
    } catch (e) {
      showError(e);
    } finally {
      loading = false;
    }
  }

  async function handleBranchSwitch() {
    await refreshStatus();
    await refreshPanelData();
  }
</script>

<div class="change-summary">
  <div class="summary-header">
    <h3 class="summary-title">Change Summary</h3>
    {#if status?.branch}
      <BranchSwitcher
        cwd={effectiveCwd}
        currentBranch={status.branch}
        onSwitch={handleBranchSwitch}
      />
    {:else}
      <span class="code-icon">&lt;&gt;</span>
    {/if}
  </div>

  {#if showDropdown}
    <div class="repo-selector">
      <span class="repo-label">REPOSITORY</span>
      <select class="repo-dropdown" bind:value={selectedProjectName}>
        {#each projects! as project}
          <option value={project.name}>{project.name}</option>
        {/each}
      </select>
    </div>
  {:else if effectiveProject}
    <div class="repo-indicator">
      <span class="repo-label">REPOSITORY</span>
      <span class="repo-name">{effectiveProject.name}</span>
    </div>
  {/if}

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

  <div class="phase-group" class:phase-fading={transitioning}>
    {#if visiblePhase === "commit"}
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

    {#if errorMsg}
      <div class="error-banner">
        <span class="error-text">{errorMsg}</span>
        <button class="error-dismiss" onclick={clearError}>&times;</button>
      </div>
    {/if}

    <div class="actions">
      {#if visiblePhase === "stage"}
        <ActionButton
          label="STAGE CHANGES"
          loadingLabel="STAGING..."
          variant="secondary"
          {loading}
          done={stageDone}
          onclick={handleStage}
        />
      {:else if visiblePhase === "commit"}
        <ActionButton
          label="COMMIT"
          loadingLabel="COMMITTING..."
          variant="primary"
          {loading}
          done={commitDone}
          disabled={!commitMsg.trim()}
          onclick={handleCommit}
        />
      {:else if visiblePhase === "push"}
        <ActionButton
          label="PUSH"
          loadingLabel="PUSHING..."
          variant="primary"
          {loading}
          done={pushDone}
          onclick={handlePush}
        />
      {:else if visiblePhase === "clean"}
        <ActionButton
          label="UP TO DATE"
          variant="surface"
          disabled={true}
        />
      {:else}
        <ActionButton
          label=""
          variant="secondary"
          loading={true}
          loadingLabel=""
        />
      {/if}

      {#if visiblePhase !== "clean" && visiblePhase !== "push" && visiblePhase !== "loading"}
        <ActionButton
          label="DISCARD ALL"
          loadingLabel="..."
          variant="danger"
          {loading}
          onclick={handleDiscard}
        />
      {/if}
    </div>
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

  .repo-selector,
  .repo-indicator {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .repo-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--on-surface-variant);
  }

  .repo-dropdown {
    flex: 1;
    padding: 6px 10px;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    color: var(--on-surface);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .repo-dropdown:focus {
    border-color: var(--primary);
  }

  .repo-dropdown option {
    background: var(--surface-container-highest);
    color: var(--on-surface);
  }

  .repo-name {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--on-surface);
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

  /* Error banner */
  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin-bottom: 12px;
    background: color-mix(in srgb, var(--error) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
    border-radius: 8px;
  }

  .error-text {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--error);
    line-height: 1.4;
    word-break: break-word;
  }

  .error-dismiss {
    background: none;
    border: none;
    color: var(--error);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .error-dismiss:hover {
    opacity: 1;
  }

  /* Phase group: fades the commit section + actions together */
  .phase-group {
    animation: phase-in 0.4s ease both;
  }

  .phase-group.phase-fading {
    animation: phase-out 0.5s ease both;
  }

  @keyframes phase-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes phase-out {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(-4px); }
  }

  /* Actions */
  .actions {
    display: flex;
    gap: 10px;
    min-height: 40px;
    align-items: center;
  }
</style>
