<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { settingsOpen } from "../../stores/settings";

  const dispatch = createEventDispatcher<{
    newSession: { workspacePath: string };
    selectSession: { workspacePath: string; sessionId: string };
    deleteSession: { workspacePath: string; sessionId: string };
    deleteWorkspace: { workspacePath: string };
    selectWorkspace: { workspacePath: string };
    setWorkspaceColor: { workspacePath: string; color: string };
    addWorkspace: void;
    newTerminal: void;
  }>();

  const WORKSPACE_COLORS = [
    "#e6194B", // red
    "#3cb44b", // green
    "#ffe119", // yellow
    "#4363d8", // blue
    "#f58231", // orange
    "#42d4f4", // cyan
    "#f032e6", // magenta
    "#fabed4", // pink
    "#469990", // teal
    "#dcbeff", // lavender
  ];

  interface Session {
    id: string;
    label: string;
    status: "complete" | "running" | "error" | "idle" | "starting";
    age: string;
    terminalTabId: string | null;
  }

  interface Workspace {
    path: string;
    name: string;
    color?: string;
    sessions: Session[];
  }

  let {
    workspaces = [] as Workspace[],
    activeWorkspacePath = "",
    activeSessionId = "",
    openTabIds = new Set<string>(),
  }: {
    workspaces?: Workspace[];
    activeWorkspacePath?: string;
    activeSessionId?: string;
    openTabIds?: Set<string>;
  } = $props();

  function isSessionOpen(session: Session): boolean {
    return !!session.terminalTabId && openTabIds.has(session.terminalTabId);
  }

  let filterText = $state("");
  let expandedPaths = $state<string[]>([]);
  let selectedPath = $state("");
  let colorPickerPath = $state<string | null>(null);

  function toggleColorPicker(e: Event, path: string) {
    e.stopPropagation();
    colorPickerPath = colorPickerPath === path ? null : path;
  }

  function pickColor(e: Event, workspacePath: string, color: string) {
    e.stopPropagation();
    dispatch("setWorkspaceColor", { workspacePath, color });
    colorPickerPath = null;
  }

  function handleWindowClick() {
    if (colorPickerPath) colorPickerPath = null;
  }

  // Sync selected path from prop when it changes externally
  $effect(() => {
    if (activeWorkspacePath && activeWorkspacePath !== selectedPath) {
      selectedPath = activeWorkspacePath;
      // Auto-expand if it has sessions
      const ws = workspaces.find((w) => w.path === activeWorkspacePath);
      if (ws && ws.sessions.length > 0 && !expandedPaths.includes(activeWorkspacePath)) {
        expandedPaths = [...expandedPaths, activeWorkspacePath];
      }
    }
  });

  function toggleExpand(path: string) {
    if (expandedPaths.includes(path)) {
      expandedPaths = expandedPaths.filter((p) => p !== path);
    } else {
      expandedPaths = [...expandedPaths, path];
    }
  }

  function selectWorkspace(path: string) {
    selectedPath = path;
    dispatch("selectWorkspace", { workspacePath: path });
  }

  function handleWorkspaceClick(workspace: Workspace) {
    selectWorkspace(workspace.path);
    // Toggle expand if there are sessions to show
    if (workspace.sessions.length > 0) {
      toggleExpand(workspace.path);
    }
  }

  function handleArrowClick(e: Event, path: string) {
    e.stopPropagation();
    toggleExpand(path);
  }

  const filteredWorkspaces = $derived(
    filterText
      ? workspaces.filter((w) =>
          w.name.toLowerCase().includes(filterText.toLowerCase()),
        )
      : workspaces,
  );

  function sessionIcon(session: Session): string {
    if (session.status === "error") return "error";
    return isSessionOpen(session) ? "circle" : "radio_button_unchecked";
  }

  function sessionIconColor(session: Session): string {
    if (session.status === "error") return "var(--error)";
    return isSessionOpen(session) ? "var(--secondary)" : "var(--on-surface-variant)";
  }

  function sessionIconFill(session: Session): number {
    return isSessionOpen(session) ? 1 : 0;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<aside class="agent-manager">
  <div class="header">
    <div class="filter-wrap">
      <span class="material-symbols-outlined filter-icon">search</span>
      <input
        class="filter-input"
        type="text"
        placeholder="Filter workspaces..."
        bind:value={filterText}
      />
    </div>
  </div>

  <nav class="workspace-tree">
    <div class="tree-header">
      <span class="tree-label">Workspaces</span>
      <div class="tree-header-actions">
        <button
          class="settings-btn"
          title="Open terminal"
          onclick={() => dispatch("newTerminal")}
        >
          <span class="material-symbols-outlined">terminal</span>
        </button>
        <button
          class="settings-btn"
          title="Settings"
          onclick={() => settingsOpen.set(true)}
        >
          <span class="material-symbols-outlined">settings</span>
        </button>
        <button
          class="add-workspace-btn"
          title="Add workspace folder"
          onclick={() => dispatch("addWorkspace")}
        >
          <span class="material-symbols-outlined">create_new_folder</span>
        </button>
      </div>
    </div>

    {#each filteredWorkspaces as workspace (workspace.path)}
      {@const hasSessions = workspace.sessions.length > 0}
      {@const isExpanded = hasSessions && expandedPaths.includes(workspace.path)}
      {@const isSelected = workspace.path === selectedPath}
      <div class="workspace-group">
        <div class="workspace-row" class:selected={isSelected}>
          {#if hasSessions}
            <button
              class="arrow-btn"
              onclick={(e) => handleArrowClick(e, workspace.path)}
            >
              <span class="material-symbols-outlined arrow-icon">
                {isExpanded ? "keyboard_arrow_down" : "keyboard_arrow_right"}
              </span>
            </button>
          {/if}
          <button
            class="workspace-main"
            class:no-arrow={!hasSessions}
            onclick={() => handleWorkspaceClick(workspace)}
          >
            <span class="material-symbols-outlined folder-icon" class:open={isExpanded}>
              {isExpanded ? "folder_open" : "folder"}
            </span>
            <span class="workspace-name" class:selected={isSelected}>
              {workspace.name}
            </span>
          </button>
          <div class="color-picker-wrap">
            <button
              class="color-dot-btn"
              title="Set workspace color"
              onclick={(e) => toggleColorPicker(e, workspace.path)}
            >
              <span
                class="ws-color-dot"
                style="background: {workspace.color ?? WORKSPACE_COLORS[0]}"
              ></span>
            </button>
            {#if colorPickerPath === workspace.path}
              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
              <div class="color-dropdown" onclick={(e) => e.stopPropagation()}>
                {#each WORKSPACE_COLORS as color (color)}
                  <button
                    class="color-swatch"
                    class:active={workspace.color === color}
                    style="background: {color}"
                    title={color}
                    onclick={(e) => pickColor(e, workspace.path, color)}
                  ></button>
                {/each}
              </div>
            {/if}
          </div>
          <button
            class="new-session-inline"
            title="New session"
            onclick={() => dispatch("newSession", { workspacePath: workspace.path })}
          >
            <span class="material-symbols-outlined">add</span>
          </button>
          <button
            class="delete-workspace-btn"
            title="Remove workspace"
            onclick={(e) => {
              e.stopPropagation();
              dispatch("deleteWorkspace", { workspacePath: workspace.path });
            }}
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        {#if isExpanded}
          <div class="session-list">
            {#each workspace.sessions as session (session.id)}
              <div
                class="session-row"
                class:active={session.id === activeSessionId}
                role="button"
                tabindex="0"
                onclick={() =>
                  dispatch("selectSession", {
                    workspacePath: workspace.path,
                    sessionId: session.id,
                  })}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    dispatch("selectSession", {
                      workspacePath: workspace.path,
                      sessionId: session.id,
                    });
                  }
                }}
              >
                <div class="session-info">
                  <span
                    class="material-symbols-outlined session-status-icon"
                    style="color: {sessionIconColor(session)}; font-variation-settings: 'FILL' {sessionIconFill(session)}"
                  >
                    {sessionIcon(session)}
                  </span>
                  <span class="session-label" class:session-open={isSessionOpen(session)}>{session.label}</span>
                </div>
                {#if session.status === "starting"}
                  <span class="material-symbols-outlined session-spinner">progress_activity</span>
                {:else}
                  <span class="session-age">{session.age}</span>
                {/if}
                <button
                  class="delete-session-btn"
                  title="Delete session"
                  onclick={(e) => {
                    e.stopPropagation();
                    dispatch("deleteSession", {
                      workspacePath: workspace.path,
                      sessionId: session.id,
                    });
                  }}
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>
</aside>

<style>
  .agent-manager {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface-container-low);
    border-right: 1px solid var(--outline-variant);
    user-select: none;
    -webkit-user-select: none;
    font-family: var(--font-body);
  }

  /* ── Header ── */
  .header {
    padding: 1.25rem 1.25rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  /* ── Filter ── */
  .filter-wrap {
    position: relative;
  }

  .filter-icon {
    position: absolute;
    left: 0.6rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.85rem !important;
    color: var(--on-surface-variant);
    pointer-events: none;
  }

  .filter-input {
    width: 100%;
    background: var(--surface-container-lowest);
    color: var(--on-surface);
    font-size: 0.75rem;
    font-family: var(--font-body);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem 0.5rem 2rem;
    outline: none;
    transition: border-color 0.15s;
  }

  .filter-input::placeholder {
    color: var(--on-surface-variant);
    opacity: 0.5;
  }

  .filter-input:focus {
    border-color: color-mix(in srgb, var(--primary) 50%, transparent);
  }

  /* ── Tree header with Add Workspace ── */
  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.75rem;
    margin-bottom: 0.4rem;
  }

  .tree-label {
    font-size: 0.8rem;
    font-family: var(--font-display);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface);
    opacity: 0.7;
  }

  .tree-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .settings-btn,
  .add-workspace-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }

  .settings-btn:hover,
  .add-workspace-btn:hover {
    color: var(--primary);
  }

  .settings-btn :global(.material-symbols-outlined),
  .add-workspace-btn :global(.material-symbols-outlined) {
    font-size: 1.15rem;
  }

  /* ── Workspace tree ── */
  .workspace-tree {
    flex: 1;
    overflow-y: auto;
    padding: 0.9rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .workspace-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .workspace-row {
    display: flex;
    align-items: center;
    padding: 0.1rem 0.4rem 0.1rem 0.5rem;
    border-radius: var(--radius);
    transition: background 0.15s;
  }

  .workspace-row:hover {
    background: var(--surface-container-high);
  }

  .workspace-row.selected {
    background: color-mix(in srgb, var(--surface-container-high) 60%, transparent);
  }

  .arrow-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0.35rem 0;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .arrow-icon {
    font-size: 0.95rem !important;
  }

  .workspace-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    font-size: 0.8rem;
    font-family: var(--font-body);
    cursor: pointer;
    padding: 0.4rem 0.25rem;
    text-align: left;
  }

  .workspace-main.no-arrow {
    padding-left: 0.1rem;
  }

  .folder-icon {
    font-size: 1.05rem !important;
    flex-shrink: 0;
  }

  .folder-icon.open {
    color: var(--primary);
  }

  .workspace-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workspace-name.selected {
    font-weight: 500;
    color: var(--on-surface);
  }

  .new-session-inline {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .workspace-row:hover .new-session-inline {
    opacity: 1;
  }

  .workspace-row.selected .new-session-inline {
    opacity: 0.7;
  }

  .new-session-inline:hover {
    color: var(--primary);
    opacity: 1 !important;
  }

  .new-session-inline :global(.material-symbols-outlined) {
    font-size: 1.1rem;
  }

  .delete-workspace-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .workspace-row:hover .delete-workspace-btn {
    opacity: 1;
  }

  .delete-workspace-btn:hover {
    color: var(--error);
  }

  .delete-workspace-btn :global(.material-symbols-outlined) {
    font-size: 0.85rem;
  }

  /* ── Color picker ── */
  .color-picker-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .color-dot-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.3rem;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .workspace-row:hover .color-dot-btn {
    opacity: 1;
  }

  .ws-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .color-dropdown {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
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
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s, border-color 0.1s;
    padding: 0;
  }

  .color-swatch:hover {
    transform: scale(1.2);
  }

  .color-swatch.active {
    border-color: var(--on-surface);
  }

  /* ── Session list ── */
  .session-list {
    margin-left: 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 1px solid color-mix(in srgb, var(--outline-variant) 20%, transparent);
  }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.4rem 0.5rem 0.4rem 1rem;
    background: transparent;
    border: none;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    cursor: pointer;
    transition: background 0.15s;
    text-align: left;
  }

  .session-row:hover {
    background: color-mix(in srgb, var(--surface-container-high) 50%, transparent);
  }

  .session-row.active {
    background: var(--surface-container-high);
  }

  .session-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
    min-width: 0;
  }

  .session-status-icon {
    font-size: 0.75rem !important;
    flex-shrink: 0;
  }

  .session-label {
    font-size: 0.69rem;
    color: var(--on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-label.session-open {
    color: var(--on-surface);
  }

  .session-age {
    font-size: 0.55rem;
    color: var(--on-surface-variant);
    opacity: 0;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }

  .session-row:hover .session-age {
    opacity: 1;
  }

  .session-spinner {
    font-size: 0.7rem;
    color: var(--primary);
    flex-shrink: 0;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .delete-session-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0.15rem;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .session-row:hover .delete-session-btn {
    opacity: 1;
  }

  .delete-session-btn:hover {
    color: var(--error);
  }

  .delete-session-btn :global(.material-symbols-outlined) {
    font-size: 0.8rem;
  }

</style>
