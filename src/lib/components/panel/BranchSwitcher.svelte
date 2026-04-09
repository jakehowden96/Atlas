<script lang="ts">
  import { gitListBranches, gitCheckoutBranch, gitCreateBranch } from "../../ipc";
  import { showToast } from "../../stores/toast";
  import type { BranchInfo } from "../../../types/panel";

  interface Props {
    cwd: string;
    currentBranch: string;
    onSwitch?: () => void;
  }

  let { cwd, currentBranch, onSwitch }: Props = $props();

  let open = $state(false);
  let branches = $state<BranchInfo[]>([]);
  let loadingBranches = $state(false);
  let switching = $state<string | null>(null);
  let creating = $state(false);
  let newBranchName = $state("");
  let dropdownEl: HTMLDivElement = $state(null!);
  let newBranchInput: HTMLInputElement = $state(null!);

  async function toggleDropdown() {
    if (open) {
      open = false;
      return;
    }
    loadingBranches = true;
    open = true;
    try {
      branches = await gitListBranches(cwd);
    } catch (e) {
      showToast(`Failed to list branches: ${e}`);
      open = false;
    } finally {
      loadingBranches = false;
    }
  }

  async function selectBranch(branch: string) {
    if (branch === currentBranch) {
      open = false;
      return;
    }
    switching = branch;
    try {
      await gitCheckoutBranch(cwd, branch);
      open = false;
      onSwitch?.();
    } catch (e) {
      showToast(`Checkout failed: ${e}`);
    } finally {
      switching = null;
    }
  }

  function showCreateForm() {
    creating = true;
    newBranchName = "";
    requestAnimationFrame(() => newBranchInput?.focus());
  }

  async function handleCreate() {
    const name = newBranchName.trim();
    if (!name) return;
    switching = name;
    try {
      await gitCreateBranch(cwd, name);
      creating = false;
      newBranchName = "";
      open = false;
      onSwitch?.();
    } catch (e) {
      showToast(`Create branch failed: ${e}`);
    } finally {
      switching = null;
    }
  }

  function handleCreateKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      creating = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (creating) {
        creating = false;
      } else {
        open = false;
      }
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener("click", handleClickOutside, true);
      document.addEventListener("keydown", handleKeydown);
      return () => {
        document.removeEventListener("click", handleClickOutside, true);
        document.removeEventListener("keydown", handleKeydown);
      };
    }
  });
</script>

<div class="branch-switcher" bind:this={dropdownEl}>
  <button class="branch-trigger" onclick={toggleDropdown} title="Switch branch">
    <span class="material-symbols-outlined branch-icon">fork_right</span>
    <span class="branch-name">{currentBranch || "..."}</span>
    <span class="material-symbols-outlined chevron" class:open>{open ? "expand_less" : "expand_more"}</span>
  </button>

  {#if open}
    <div class="branch-dropdown">
      {#if loadingBranches}
        <div class="branch-loading">
          <span class="material-symbols-outlined spinner">progress_activity</span>
        </div>
      {:else}
        {#each branches as branch}
          <button
            class="branch-item"
            class:current={branch.is_current}
            class:switching={switching === branch.name}
            onclick={() => selectBranch(branch.name)}
            disabled={switching !== null}
          >
            {#if switching === branch.name}
              <span class="material-symbols-outlined spinner item-icon">progress_activity</span>
            {:else if branch.is_current}
              <span class="material-symbols-outlined item-icon current-icon">check</span>
            {:else}
              <span class="item-icon-spacer"></span>
            {/if}
            <span class="item-name">{branch.name}</span>
          </button>
        {/each}
        {#if branches.length === 0}
          <div class="branch-empty">No branches found</div>
        {/if}
        <div class="create-divider"></div>
        {#if creating}
          <div class="create-form">
            <input
              bind:this={newBranchInput}
              class="create-input"
              type="text"
              placeholder="branch-name"
              bind:value={newBranchName}
              onkeydown={handleCreateKeydown}
              disabled={switching !== null}
            />
            <button
              class="create-confirm"
              disabled={!newBranchName.trim() || switching !== null}
              onclick={handleCreate}
            >
              {#if switching}
                <span class="material-symbols-outlined spinner" style="font-size:12px">progress_activity</span>
              {:else}
                <span class="material-symbols-outlined" style="font-size:14px">check</span>
              {/if}
            </button>
          </div>
        {:else}
          <button class="branch-item create-btn" onclick={showCreateForm} disabled={switching !== null}>
            <span class="material-symbols-outlined item-icon create-icon">add</span>
            <span class="item-name">New branch</span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .branch-switcher {
    position: relative;
  }

  .branch-trigger {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    background: color-mix(in srgb, var(--primary) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
    border-radius: 9999px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--primary);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .branch-trigger:hover {
    background: color-mix(in srgb, var(--primary) 25%, transparent);
    border-color: color-mix(in srgb, var(--primary) 50%, transparent);
  }

  .branch-icon {
    font-size: 14px;
  }

  .branch-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    font-size: 14px;
    opacity: 0.6;
    transition: transform 0.15s;
  }

  .branch-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 200px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 100;
    padding: 4px;
  }

  .branch-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--on-surface);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .branch-item:hover:not(:disabled) {
    background: var(--surface-bright);
  }

  .branch-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .branch-item.current {
    color: var(--primary);
    font-weight: 600;
  }

  .item-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .current-icon {
    color: var(--primary);
  }

  .item-icon-spacer {
    width: 14px;
    flex-shrink: 0;
  }

  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-empty {
    padding: 12px;
    text-align: center;
    font-size: 12px;
    color: var(--on-surface-variant);
  }

  .spinner {
    font-size: 14px;
    animation: spin 1s linear infinite;
  }

  .create-divider {
    height: 1px;
    background: var(--outline-variant);
    margin: 4px 0;
  }

  .create-btn {
    color: var(--primary);
  }

  .create-icon {
    color: var(--primary);
  }

  .create-form {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
  }

  .create-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    color: var(--on-surface);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }

  .create-input:focus {
    border-color: var(--primary);
  }

  .create-input::placeholder {
    color: var(--on-surface-variant);
    opacity: 0.5;
  }

  .create-confirm {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--primary);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .create-confirm:hover:not(:disabled) {
    background: var(--surface-bright);
  }

  .create-confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
