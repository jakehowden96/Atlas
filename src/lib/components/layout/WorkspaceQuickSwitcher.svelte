<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import { WORKSPACE_COLORS } from "../../stores/workspace";

  interface Workspace {
    path: string;
    name: string;
    color?: string;
    sessions: { createdAt: string }[];
  }

  let { open = $bindable(false), workspaces = [] as Workspace[] }: {
    open?: boolean;
    workspaces?: Workspace[];
  } = $props();

  const dispatch = createEventDispatcher<{
    pickWorkspace: { workspacePath: string };
    addWorkspace: void;
    setWorkspaceColor: { workspacePath: string; color: string };
    deleteWorkspace: { workspacePath: string };
  }>();

  let filterText = $state("");
  let highlightIndex = $state(0);
  let inputEl: HTMLInputElement | null = $state(null);
  let manageMode = $state(false);
  let colorPickerPath = $state<string | null>(null);

  $effect(() => {
    if (open) {
      filterText = "";
      highlightIndex = 0;
      manageMode = false;
      colorPickerPath = null;
      tick().then(() => inputEl?.focus());
    }
  });

  // Recency: latest createdAt among sessions wins. No sessions → epoch 0.
  function recencyOf(ws: Workspace): number {
    let max = 0;
    for (const s of ws.sessions) {
      const t = Date.parse(s.createdAt);
      if (!Number.isNaN(t) && t > max) max = t;
    }
    return max;
  }

  let sortedWorkspaces = $derived(
    [...workspaces].sort((a, b) => recencyOf(b) - recencyOf(a)),
  );

  let filteredWorkspaces = $derived(
    filterText
      ? sortedWorkspaces.filter((w) => w.name.toLowerCase().includes(filterText.toLowerCase()))
      : sortedWorkspaces,
  );

  // Reset highlight when results shrink
  $effect(() => {
    if (highlightIndex >= filteredWorkspaces.length) {
      highlightIndex = Math.max(0, filteredWorkspaces.length - 1);
    }
  });

  function close() {
    open = false;
  }

  function pick(workspacePath: string) {
    dispatch("pickWorkspace", { workspacePath });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    // The "+1" slot at the end of the list is Add folder.
    const totalRows = filteredWorkspaces.length + 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightIndex = (highlightIndex + 1) % totalRows;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightIndex = (highlightIndex - 1 + totalRows) % totalRows;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex === filteredWorkspaces.length) {
        dispatch("addWorkspace");
      } else {
        const ws = filteredWorkspaces[highlightIndex];
        if (ws) pick(ws.path);
      }
    }
  }

  function toggleColorPicker(e: Event, path: string) {
    e.stopPropagation();
    colorPickerPath = colorPickerPath === path ? null : path;
  }

  function pickColor(e: Event, path: string, color: string) {
    e.stopPropagation();
    dispatch("setWorkspaceColor", { workspacePath: path, color });
    colorPickerPath = null;
  }

  function confirmDelete(e: Event, ws: Workspace) {
    e.stopPropagation();
    const ok = confirm(`Remove workspace "${ws.name}"? Sessions will be closed.`);
    if (ok) dispatch("deleteWorkspace", { workspacePath: ws.path });
  }
</script>

{#if open}
  <div class="qs-overlay" onclick={close} role="presentation">
    <div
      class="qs-modal"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
      role="dialog"
      aria-label="Pick a workspace"
      tabindex="-1"
    >
      <div class="qs-head">
        <span class="material-symbols-outlined head-icon">search</span>
        <input
          bind:this={inputEl}
          bind:value={filterText}
          class="qs-input"
          type="text"
          placeholder={manageMode ? "Manage workspaces…" : "Pick a workspace for new session…"}
          autocomplete="off"
          spellcheck="false"
        />
        <button
          class="manage-btn"
          class:active={manageMode}
          title={manageMode ? "Exit manage mode" : "Manage workspaces"}
          onclick={() => (manageMode = !manageMode)}
        >
          <span class="material-symbols-outlined">tune</span>
        </button>
        <button class="close-btn" onclick={close} title="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="qs-list">
        {#each filteredWorkspaces as ws, i (ws.path)}
          {@const isHighlighted = i === highlightIndex && !manageMode}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="qs-row"
            class:highlighted={isHighlighted}
            role="button"
            tabindex="-1"
            onclick={() => (manageMode ? null : pick(ws.path))}
            onmouseenter={() => (highlightIndex = i)}
          >
            <div class="qs-color-wrap">
              <button
                class="qs-color-dot"
                onclick={(e) => toggleColorPicker(e, ws.path)}
                title="Set color"
              >
                <span class="dot" style="background: {ws.color ?? WORKSPACE_COLORS[0]}"></span>
              </button>
              {#if colorPickerPath === ws.path}
                <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                <div class="color-dropdown" onclick={(e) => e.stopPropagation()}>
                  {#each WORKSPACE_COLORS as c (c)}
                    <button
                      class="color-swatch"
                      class:active={ws.color === c}
                      style="background: {c}"
                      title={c}
                      aria-label={`Set color to ${c}`}
                      onclick={(e) => pickColor(e, ws.path, c)}
                    ></button>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="qs-row-text">
              <span class="qs-name">{ws.name}</span>
              <span class="qs-path" title={ws.path}>{ws.path}</span>
            </div>
            <span class="qs-sessions" title="Active sessions">
              {ws.sessions.length}
            </span>
            {#if manageMode}
              <button
                class="qs-delete"
                title="Remove workspace"
                onclick={(e) => confirmDelete(e, ws)}
              >
                <span class="material-symbols-outlined">delete</span>
              </button>
            {/if}
          </div>
        {/each}

        {#if !manageMode}
          {@const addRowHighlighted = highlightIndex === filteredWorkspaces.length}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="qs-row qs-add"
            class:highlighted={addRowHighlighted}
            role="button"
            tabindex="-1"
            onclick={() => dispatch("addWorkspace")}
            onmouseenter={() => (highlightIndex = filteredWorkspaces.length)}
          >
            <span class="material-symbols-outlined add-icon">create_new_folder</span>
            <span class="qs-add-label">Add folder…</span>
          </div>
        {/if}

        {#if filteredWorkspaces.length === 0 && !manageMode}
          <div class="qs-empty">
            <span>No workspaces match "{filterText}"</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .qs-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
  }

  .qs-modal {
    width: 100%;
    max-width: 540px;
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 60vh;
  }

  .qs-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--outline-variant);
  }

  .head-icon {
    font-size: 1rem !important;
    color: var(--on-surface-variant);
  }

  .qs-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 0.85rem;
    padding: 0.3rem 0;
  }

  .qs-input::placeholder { color: var(--on-surface-variant); opacity: 0.5; }

  .manage-btn,
  .close-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: background 0.15s, color 0.15s;
  }
  .manage-btn:hover,
  .close-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }
  .manage-btn.active {
    background: var(--surface-container-high);
    color: var(--primary);
  }
  .manage-btn :global(.material-symbols-outlined),
  .close-btn :global(.material-symbols-outlined) { font-size: 1rem; }

  .qs-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }

  .qs-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--on-surface);
    font-size: 0.8rem;
    user-select: none;
    transition: background 0.1s;
  }

  .qs-row.highlighted {
    background: var(--surface-container-high);
  }

  .qs-color-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .qs-color-dot {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .qs-color-dot:hover { background: var(--surface-container-highest); }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: block; }

  .color-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 300;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    padding: 6px;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .color-swatch {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .color-swatch:hover { transform: scale(1.15); }
  .color-swatch.active { border-color: var(--on-surface); }

  .qs-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .qs-name {
    color: var(--on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .qs-path {
    font-size: 0.65rem;
    color: var(--on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.7;
  }
  .qs-sessions {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--on-surface-variant);
    padding: 1px 6px;
    background: var(--surface-container-highest);
    border-radius: 10px;
    flex-shrink: 0;
  }

  .qs-delete {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
  }
  .qs-delete:hover { color: var(--error); background: var(--surface-container-highest); }
  .qs-delete :global(.material-symbols-outlined) { font-size: 1rem; }

  .qs-add {
    color: var(--on-surface-variant);
    border-top: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    margin-top: 4px;
    padding-top: 0.55rem;
  }
  .qs-add .add-icon { font-size: 1.1rem !important; color: var(--primary); }
  .qs-add-label { color: var(--on-surface); font-weight: 500; }

  .qs-empty {
    padding: 1.2rem 0.8rem;
    text-align: center;
    color: var(--on-surface-variant);
    font-size: 0.75rem;
    opacity: 0.7;
  }
</style>
