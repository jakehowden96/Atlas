<script lang="ts">
  import { settingsOpen, excludedFolders, loadExcludedFolders, saveExcludedFolders } from "../../stores/settings";

  let newFolder = $state("");
  let folders: string[] = $state([]);

  $effect(() => {
    const unsub = excludedFolders.subscribe((v) => (folders = [...v]));
    return unsub;
  });

  $effect(() => {
    if ($settingsOpen) {
      loadExcludedFolders();
    }
  });

  function addFolder() {
    const trimmed = newFolder.trim();
    if (!trimmed || folders.includes(trimmed)) {
      newFolder = "";
      return;
    }
    const updated = [...folders, trimmed];
    saveExcludedFolders(updated);
    newFolder = "";
  }

  function removeFolder(name: string) {
    const updated = folders.filter((f) => f !== name);
    saveExcludedFolders(updated);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      addFolder();
    }
  }

  function close() {
    settingsOpen.set(false);
  }
</script>

{#if $settingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="settings-overlay" onclick={close} role="presentation">
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="settings-modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <div class="settings-header">
        <span class="settings-title">Settings</span>
        <button class="close-btn" onclick={close}>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="settings-body">
        <div class="section">
          <div class="section-label">Excluded Folders</div>
          <p class="section-desc">
            Folder names to skip when discovering repos below the current directory.
          </p>

          <div class="folder-list">
            {#each folders as folder}
              <div class="folder-item">
                <span class="folder-name">{folder}</span>
                <button class="remove-btn" onclick={() => removeFolder(folder)} title="Remove">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            {/each}
          </div>

          <div class="add-row">
            <input
              type="text"
              class="folder-input"
              bind:value={newFolder}
              onkeydown={handleKeydown}
              placeholder="e.g. vendor"
            />
            <button class="add-btn" onclick={addFolder} disabled={!newFolder.trim()}>
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 48px;
  }

  .settings-modal {
    width: 100%;
    max-width: 360px;
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--outline-variant);
  }

  .settings-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--on-surface);
    font-family: var(--font-body);
  }

  .close-btn {
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

  .close-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .close-btn :global(.material-symbols-outlined) {
    font-size: 1rem;
  }

  .settings-body {
    padding: 1rem;
  }

  .section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    margin-bottom: 0.35rem;
  }

  .section-desc {
    font-size: 12px;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    line-height: 1.45;
    margin: 0 0 0.75rem;
    opacity: 0.7;
  }

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 0.75rem;
  }

  .folder-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.5rem;
    background: var(--surface-container-high);
    border-radius: var(--radius-sm);
  }

  .folder-name {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--on-surface);
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-radius: var(--radius-sm);
    padding: 0;
    transition: background 0.15s, color 0.15s;
  }

  .remove-btn:hover {
    background: var(--error-container);
    color: var(--error);
  }

  .remove-btn :global(.material-symbols-outlined) {
    font-size: 0.85rem;
  }

  .add-row {
    display: flex;
    gap: 6px;
  }

  .folder-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface);
    font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
    transition: border-color 0.15s;
  }

  .folder-input::placeholder {
    color: var(--on-surface-variant);
    opacity: 0.4;
  }

  .folder-input:focus {
    border-color: var(--primary);
  }

  .add-btn {
    padding: 0.4rem 0.75rem;
    background: var(--primary);
    color: var(--on-primary);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-body);
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .add-btn:hover {
    opacity: 0.85;
  }

  .add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
