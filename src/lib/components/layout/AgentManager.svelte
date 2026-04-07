<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    newSession: { workspacePath: string };
    selectSession: { workspacePath: string; sessionId: string };
    selectWorkspace: { workspacePath: string };
    addWorkspace: void;
  }>();

  interface Session {
    id: string;
    label: string;
    status: "complete" | "running" | "error" | "idle";
    age: string;
  }

  interface Workspace {
    path: string;
    name: string;
    sessions: Session[];
  }

  let {
    workspaces = [] as Workspace[],
    activeWorkspacePath = "",
    activeSessionId = "",
  }: {
    workspaces?: Workspace[];
    activeWorkspacePath?: string;
    activeSessionId?: string;
  } = $props();

  let filterText = $state("");
  let expandedPaths = $state<string[]>([]);
  let selectedPath = $state("");

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

  const statusIcon: Record<Session["status"], string> = {
    complete: "check_circle",
    running: "progress_activity",
    error: "error",
    idle: "history",
  };

  const statusColor: Record<Session["status"], string> = {
    complete: "var(--secondary)",
    running: "var(--primary)",
    error: "var(--error)",
    idle: "var(--on-surface-variant)",
  };
</script>

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
      <button
        class="add-workspace-btn"
        title="Add workspace folder"
        onclick={() => dispatch("addWorkspace")}
      >
        <span class="material-symbols-outlined">create_new_folder</span>
      </button>
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
          <button
            class="new-session-inline"
            title="New session"
            onclick={() => dispatch("newSession", { workspacePath: workspace.path })}
          >
            <span class="material-symbols-outlined">add</span>
          </button>
        </div>

        {#if isExpanded}
          <div class="session-list">
            {#each workspace.sessions as session (session.id)}
              <button
                class="session-row"
                class:active={session.id === activeSessionId}
                onclick={() =>
                  dispatch("selectSession", {
                    workspacePath: workspace.path,
                    sessionId: session.id,
                  })}
              >
                <div class="session-info">
                  <span
                    class="material-symbols-outlined session-status-icon"
                    style="color: {statusColor[session.status]}"
                  >
                    {statusIcon[session.status]}
                  </span>
                  <span class="session-label">{session.label}</span>
                </div>
                <span class="session-age">{session.age}</span>
              </button>
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
    width: 280px;
    min-width: 240px;
    height: 100%;
    background: var(--surface-container-low);
    border-right: 1px solid var(--outline-variant);
    flex-shrink: 0;
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

  .add-workspace-btn:hover {
    color: var(--primary);
  }

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
    font-size: 0.75rem;
    font-family: var(--font-body);
    cursor: pointer;
    padding: 0.4rem 0.25rem;
    text-align: left;
  }

  .workspace-main.no-arrow {
    padding-left: 0.1rem;
  }

  .folder-icon {
    font-size: 0.95rem !important;
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
    font-size: 1rem;
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
    font-size: 0.65rem !important;
    flex-shrink: 0;
  }

  .session-label {
    font-size: 0.69rem;
    color: var(--on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

</style>
