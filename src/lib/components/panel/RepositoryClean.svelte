<script lang="ts">
  import { tick } from "svelte";
  import { panelData } from "../../stores/panel";
  import { activeTabId } from "../../stores/terminal";
  import { getGitStatus, getChildRepos, gitFetch, gitPull, refreshPanel } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import { get } from "svelte/store";
  import type { GitStatus, RepoInfo } from "../../../types/panel";
  import ActionButton from "./ActionButton.svelte";
  import BranchSwitcher from "./BranchSwitcher.svelte";

  let status: GitStatus | null = $state(null);
  let childRepos = $state<RepoInfo[]>([]);
  let isMultiRepo = $state<boolean>(false);
  let checking = $state(false);
  let pulling = $state(false);
  let pullDone = $state(false);

  let cwd = $derived($panelData?.cwd ?? "");
  let hasBehind = $derived.by(() => {
    if (isMultiRepo) {
      return childRepos.some((r) => r.commits_behind > 0);
    }
    return (status?.commits_behind ?? 0) > 0;
  });
  let totalBehind = $derived.by(() => {
    if (isMultiRepo) {
      return childRepos.reduce((sum, r) => sum + r.commits_behind, 0);
    }
    return status?.commits_behind ?? 0;
  });
  let projectName = $derived(cwd.split("/").pop() ?? "workspace");

  // Re-fetch status when panelData updates (e.g. after git checkout in terminal)
  $effect(() => {
    void $panelData;
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

  async function refreshPanelData() {
    const data = await refreshPanel(get(activeTabId), cwd);
    panelData.set(data);
  }

  async function handleCheckForUpdates() {
    if (!cwd) return;
    checking = true;
    await tick();
    try {
      if (isMultiRepo) {
        await Promise.all(childRepos.map((r) => gitFetch(`${cwd}/${r.name}`)));
      } else {
        await gitFetch(cwd);
      }
      await refreshPanelData();
      await fetchStatus();
      checking = false;
    } catch (e) {
      showToast(`Check failed: ${e}`);
      checking = false;
    }
  }

  async function handlePull() {
    if (!cwd) return;
    pulling = true;
    pullDone = false;
    await tick();
    try {
      if (isMultiRepo) {
        const behind = childRepos.filter((r) => r.commits_behind > 0);
        await Promise.all(behind.map((r) => gitPull(`${cwd}/${r.name}`)));
      } else {
        await gitPull(cwd);
      }
      await refreshPanelData();
      await fetchStatus();
      pulling = false;
      pullDone = true;
    } catch (e) {
      showToast(`Pull failed: ${e}`);
      pulling = false;
    }
  }

  async function handleBranchSwitch() {
    await fetchStatus();
    await refreshPanelData();
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
          <BranchSwitcher
            cwd="{cwd}/{repo.name}"
            currentBranch={repo.branch}
            onSwitch={handleBranchSwitch}
          />
        </div>
      {/each}
    </div>
  {:else}
    <div class="info-row">
      <div class="info-pill">
        <span class="info-label">Active Branch</span>
        <BranchSwitcher
          cwd={cwd}
          currentBranch={status?.branch ?? "..."}
          onSwitch={handleBranchSwitch}
        />
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
    <ActionButton
      label="Check for Updates"
      loadingLabel="Checking..."
      variant="surface"
      loading={checking}
      disabled={pulling}
      onclick={handleCheckForUpdates}
    />
    {#if hasBehind || pullDone}
      <ActionButton
        label="Pull {totalBehind} update{totalBehind !== 1 ? 's' : ''}"
        loadingLabel="Pulling..."
        icon="cloud_download"
        variant="primary"
        loading={pulling}
        done={pullDone}
        fadeWhenDone={true}
        disabled={checking}
        onclick={handlePull}
      />
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
    flex: 1;
    color: var(--on-surface);
    font-weight: 500;
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
</style>
