<script lang="ts">
  import { WORKSPACE_COLORS } from "../../stores/workspace";

  interface WS {
    path: string;
    name: string;
    color?: string;
    lastUsedAt?: number;
  }

  let {
    workspaces = [] as WS[],
    onNewSession = (_: { workspacePath: string }) => {},
    onAddFolder = () => {},
    onClose = () => {},
    onSetWorkspaceColor = (_: { workspacePath: string; color: string }) => {},
    onRemoveWorkspace = (_: { workspacePath: string }) => {},
  }: {
    workspaces?: WS[];
    onNewSession?: (e: { workspacePath: string }) => void;
    onAddFolder?: () => void;
    onClose?: () => void;
    onSetWorkspaceColor?: (e: { workspacePath: string; color: string }) => void;
    onRemoveWorkspace?: (e: { workspacePath: string }) => void;
  } = $props();

  let filterText = $state("");
  let highlight = $state(0);
  let manageOpenFor = $state<string | null>(null);
  let colorPickerFor = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  const sortedWorkspaces = $derived(
    [...workspaces].sort(
      (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
    ),
  );

  const filtered = $derived(
    filterText
      ? sortedWorkspaces.filter((w) =>
          w.name.toLowerCase().includes(filterText.toLowerCase()),
        )
      : sortedWorkspaces,
  );

  // Indexes 0..filtered.length-1 are workspaces; index filtered.length is "Add folder…"
  const rowCount = $derived(filtered.length + 1);

  $effect(() => {
    // Reset highlight whenever filtered list shrinks below it
    if (highlight >= rowCount) highlight = 0;
  });

  function focusInput() {
    queueMicrotask(() => inputEl?.focus());
  }

  $effect(() => {
    focusInput();
  });

  function selectAt(index: number) {
    if (index === filtered.length) {
      onAddFolder();
      onClose();
      return;
    }
    const ws = filtered[index];
    if (!ws) return;
    onNewSession({ workspacePath: ws.path });
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight = Math.min(rowCount - 1, highlight + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = Math.max(0, highlight - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectAt(highlight);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function handleBackdropClick() {
    onClose();
  }

  function handleRowClick(index: number) {
    highlight = index;
    selectAt(index);
  }

  function toggleManage(e: Event, path: string) {
    e.stopPropagation();
    manageOpenFor = manageOpenFor === path ? null : path;
    colorPickerFor = null;
  }

  function openColorPicker(e: Event, path: string) {
    e.stopPropagation();
    colorPickerFor = path;
  }

  function pickColor(e: Event, path: string, color: string) {
    e.stopPropagation();
    onSetWorkspaceColor({ workspacePath: path, color });
    manageOpenFor = null;
    colorPickerFor = null;
  }

  function removeWs(e: Event, path: string) {
    e.stopPropagation();
    onRemoveWorkspace({ workspacePath: path });
    manageOpenFor = null;
  }

  function truncatePath(p: string): string {
    if (p.length <= 40) return p;
    return "…" + p.slice(p.length - 39);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="overlay">
  <div
    class="backdrop"
    data-testid="backdrop"
    onclick={handleBackdropClick}
  ></div>
  <div class="modal" role="dialog" aria-label="Open workspace">
    <input
      bind:this={inputEl}
      class="filter-input"
      type="text"
      placeholder="Filter workspaces…"
      bind:value={filterText}
      onkeydown={handleKeydown}
    />
    <ul class="rows" role="listbox">
      {#each filtered as ws, i (ws.path)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          role="option"
          aria-selected={i === highlight}
          class="row"
          class:highlight={i === highlight}
          onclick={() => handleRowClick(i)}
          onmouseenter={() => (highlight = i)}
        >
          <span
            class="ws-color-dot"
            style="background: {ws.color ?? WORKSPACE_COLORS[0]}"
          ></span>
          <span class="ws-name" data-testid="ws-row-name">{ws.name}</span>
          <span class="ws-path">{truncatePath(ws.path)}</span>
          <button
            class="manage-btn"
            aria-label="Manage workspace"
            title="Manage workspace"
            onclick={(e) => toggleManage(e, ws.path)}
          >
            <span class="material-symbols-outlined">more_horiz</span>
          </button>
          {#if manageOpenFor === ws.path}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="manage-menu" onclick={(e) => e.stopPropagation()}>
              <button
                class="manage-item"
                onclick={(e) => openColorPicker(e, ws.path)}
              >Change color…</button>
              <button
                class="manage-item danger"
                onclick={(e) => removeWs(e, ws.path)}
              >Remove workspace</button>
              {#if colorPickerFor === ws.path}
                <div class="color-grid">
                  {#each WORKSPACE_COLORS as color (color)}
                    <button
                      class="color-swatch"
                      class:active={ws.color === color}
                      style="background: {color}"
                      title={color}
                      onclick={(e) => pickColor(e, ws.path, color)}
                    ></button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        role="option"
        aria-selected={filtered.length === highlight}
        class="row add-folder"
        class:highlight={filtered.length === highlight}
        onclick={() => handleRowClick(filtered.length)}
        onmouseenter={() => (highlight = filtered.length)}
      >
        <span class="material-symbols-outlined add-icon">add</span>
        <span class="ws-name">Add folder…</span>
      </li>
    </ul>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
  }

  .modal {
    position: relative;
    width: min(540px, 90vw);
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .filter-input {
    width: 100%;
    background: var(--surface-container-lowest);
    color: var(--on-surface);
    font-size: 0.85rem;
    font-family: var(--font-body);
    border: none;
    border-bottom: 1px solid var(--outline-variant);
    padding: 0.75rem 1rem;
    outline: none;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 60vh;
    overflow-y: auto;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.85rem;
    font-size: 0.8rem;
    color: var(--on-surface-variant);
    cursor: pointer;
    position: relative;
  }

  .row.highlight {
    background: color-mix(in srgb, var(--primary) 18%, transparent);
    color: var(--on-surface);
  }

  .ws-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ws-name {
    font-weight: 500;
    color: var(--on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 12rem;
  }

  .ws-path {
    flex: 1;
    font-size: 0.7rem;
    color: var(--on-surface-variant);
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .manage-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .row:hover .manage-btn,
  .row.highlight .manage-btn {
    opacity: 1;
  }

  .manage-btn :global(.material-symbols-outlined) {
    font-size: 1rem;
  }

  .manage-menu {
    position: absolute;
    top: 100%;
    right: 0.85rem;
    z-index: 10;
    background: var(--surface-container-highest);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    padding: 4px;
    display: flex;
    flex-direction: column;
    min-width: 180px;
  }

  .manage-item {
    background: none;
    border: none;
    color: var(--on-surface);
    text-align: left;
    padding: 0.45rem 0.6rem;
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .manage-item:hover {
    background: color-mix(in srgb, var(--primary) 16%, transparent);
  }

  .manage-item.danger:hover {
    color: var(--error);
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    padding: 6px;
  }

  .color-swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .color-swatch.active {
    border-color: var(--on-surface);
  }

  .add-folder .add-icon {
    font-size: 1.05rem !important;
    color: var(--primary);
  }
</style>
