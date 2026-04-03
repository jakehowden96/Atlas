<script lang="ts">
  import { panelData } from "../../stores/panel";
  import { activeTabId } from "../../stores/terminal";
  import { getGitStatus, getChildRepos, gitFetch, gitPull, refreshPanel } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import { get } from "svelte/store";
  import type { GitStatus, RepoInfo } from "../../../types/panel";

  let status: GitStatus | null = $state(null);
  let childRepos: RepoInfo[] = $state([]);
  let isMultiRepo = $state(false);
  let checking = $state(false);
  let checkDone = $state(false);
  let checkFadingOut = $state(false);
  let pulling = $state(false);
  let pullSuccess = $state(false);
  let pullFadingOut = $state(false);

  let cwd = $derived($panelData?.cwd ?? "");
  let hasBehind = $derived(
    isMultiRepo
      ? childRepos.some((r) => r.commits_behind > 0)
      : (status?.commits_behind ?? 0) > 0
  );
  let totalBehind = $derived(
    isMultiRepo
      ? childRepos.reduce((sum, r) => sum + r.commits_behind, 0)
      : (status?.commits_behind ?? 0)
  );
  let projectName = $derived(cwd.split("/").pop() ?? "workspace");

  $effect(() => {
    if (cwd) {
      fetchStatus();
    }
  });

  async function fetchStatus() {
    if (!cwd) return;
    try {
      status = await getGitStatus(cwd);
      isMultiRepo = false;
      childRepos = [];
    } catch {
      // Not a git repo — try multi-repo (parent of repos)
      status = null;
      try {
        const repos = await getChildRepos(cwd);
        if (repos.length > 0) {
          isMultiRepo = true;
          childRepos = repos;
        } else {
          isMultiRepo = false;
          childRepos = [];
        }
      } catch {
        isMultiRepo = false;
        childRepos = [];
      }
    }
  }

  async function handleCheckForUpdates() {
    if (!cwd) return;
    checking = true;
    checkDone = false;
    checkFadingOut = false;
    try {
      if (isMultiRepo) {
        await Promise.all(childRepos.map((r) => gitFetch(`${cwd}/${r.name}`)));
      } else {
        await gitFetch(cwd);
      }
      await fetchStatus();
      checking = false;
      if (!hasBehind) {
        checkDone = true;
        setTimeout(() => { checkFadingOut = true; }, 800);
        setTimeout(() => { checkDone = false; checkFadingOut = false; }, 1400);
      }
    } catch (e) {
      showToast(`Check failed: ${e}`);
      checking = false;
    }
  }

  async function handlePull() {
    if (!cwd) return;
    pulling = true;
    pullSuccess = false;
    pullFadingOut = false;
    try {
      if (isMultiRepo) {
        const behind = childRepos.filter((r) => r.commits_behind > 0);
        await Promise.all(behind.map((r) => gitPull(`${cwd}/${r.name}`)));
      } else {
        await gitPull(cwd);
      }
      await refreshPanel(get(activeTabId), cwd);
      await fetchStatus();
      pulling = false;
      pullSuccess = true;
      setTimeout(() => { pullFadingOut = true; }, 800);
      setTimeout(() => { pullSuccess = false; pullFadingOut = false; }, 1400);
    } catch (e) {
      showToast(`Pull failed: ${e}`);
      pulling = false;
    }
  }
</script>

<div class="clean-state">
  <div class="clean-icon-wrapper">
    <span class="material-symbols-outlined clean-icon">check_circle</span>
  </div>

  <h2 class="clean-title">Repository Clean</h2>
  <p class="clean-subtitle">
    No local changes detected in
    <code class="project-code">{projectName}</code>
  </p>

  {#if isMultiRepo}
    <div class="repo-list">
      <span class="info-label">Repositories</span>
      {#each childRepos as repo}
        <div class="repo-row">
          <span class="material-symbols-outlined info-icon">fork_right</span>
          <span class="repo-name">{repo.name}</span>
          <span class="repo-branch">{repo.branch}</span>
        </div>
      {/each}
    </div>
  {:else}
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
        {#if (status?.commits_behind ?? 0) > 0}
          <span class="info-value behind">
            <span class="material-symbols-outlined info-icon">cloud_download</span>
            {status?.commits_behind} behind
          </span>
        {:else}
          <span class="info-value synced">
            <span class="material-symbols-outlined info-icon">cloud_done</span>
            Up to date
          </span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="btn-row">
    <button
      class="check-btn"
      class:check-done={checkDone}
      class:check-fade-out={checkFadingOut}
      onclick={handleCheckForUpdates}
      disabled={checking || pulling || checkDone}
    >
      {#if checking}
        <span class="material-symbols-outlined spinner">progress_activity</span>
        Checking...
      {:else if checkDone}
        <span class="material-symbols-outlined check-done-icon">check_circle</span>
        Up to date
      {:else}
        <span class="material-symbols-outlined check-icon">sync</span>
        Check for Updates
      {/if}
    </button>
    {#if hasBehind || pullSuccess}
      <button
        class="pull-btn"
        class:pull-success={pullSuccess}
        class:pull-fade-out={pullFadingOut}
        onclick={handlePull}
        disabled={pulling || checking || pullSuccess}
      >
        {#if pullSuccess}
          <span class="material-symbols-outlined pull-check">check_circle</span>
        {:else if pulling}
          <span class="material-symbols-outlined spinner">progress_activity</span>
          Pulling...
        {:else}
          <span class="material-symbols-outlined pull-icon">cloud_download</span>
          Pull {totalBehind} update{totalBehind !== 1 ? "s" : ""}
        {/if}
      </button>
    {/if}
  </div>
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
    display: block;
    margin-top: 0.35rem;
    padding: 2px 8px;
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--primary);
    word-break: break-all;
  }

  .info-row {
    display: flex;
    gap: 1.5rem;
    margin-top: 0.75rem;
  }

  .repo-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.75rem;
    width: 100%;
    max-width: 320px;
  }

  .repo-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--on-surface);
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface-container-high) 60%, transparent);
  }

  .repo-name {
    flex-shrink: 0;
    color: var(--on-surface);
    font-weight: 500;
  }

  .repo-branch {
    color: var(--on-surface-variant);
    margin-left: auto;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .info-value.behind {
    color: var(--primary);
  }

  .btn-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    align-items: center;
  }

  .pull-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.6rem 1.5rem;
    background: var(--primary);
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--on-primary);
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .pull-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .pull-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pull-icon {
    font-size: 0.9rem;
  }

  .pull-check {
    font-size: 1.1rem;
    font-variation-settings: 'FILL' 1;
  }

  .pull-btn.pull-success {
    background: var(--secondary);
    padding: 0.6rem 1rem;
    transition: background 0.3s, opacity 0.5s, padding 0.3s;
  }

  .pull-btn.pull-fade-out {
    opacity: 0;
  }

  .spinner {
    font-size: 0.9rem;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .check-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
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

  .check-icon {
    font-size: 0.9rem;
  }

  .check-btn.check-done {
    background: var(--secondary);
    color: var(--on-secondary);
    border-color: transparent;
    transition: background 0.3s, opacity 0.5s;
  }

  .check-btn.check-fade-out {
    opacity: 0;
  }

  .check-done-icon {
    font-size: 0.95rem;
    font-variation-settings: 'FILL' 1;
  }
</style>
