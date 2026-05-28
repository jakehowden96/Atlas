<script lang="ts">
  import { settingsOpen } from "../../stores/settings";
  import WorkspaceQuickSwitcher from "./WorkspaceQuickSwitcher.svelte";

  interface Session {
    id: string;
    label: string;
    status: "complete" | "running" | "error" | "idle" | "starting";
    age: string;
    terminalTabId: string | null;
    createdAt?: string;
  }

  interface Workspace {
    path: string;
    name: string;
    color?: string;
    lastUsedAt?: number;
    sessions: Session[];
  }

  let {
    workspaces = [] as Workspace[],
    activeWorkspacePath = "",
    activeSessionId = "",
    openTabIds = new Set<string>(),
    onNewSession = (_: { workspacePath: string }) => {},
    onSelectSession = (_: { workspacePath: string; sessionId: string }) => {},
    onDeleteSession = (_: { workspacePath: string; sessionId: string }) => {},
    onSetWorkspaceColor = (_: { workspacePath: string; color: string }) => {},
    onDeleteWorkspace = (_: { workspacePath: string }) => {},
    onAddWorkspace = () => {},
    onNewTerminal = () => {},
  }: {
    workspaces?: Workspace[];
    activeWorkspacePath?: string;
    activeSessionId?: string;
    openTabIds?: Set<string>;
    onNewSession?: (e: { workspacePath: string }) => void;
    onSelectSession?: (e: { workspacePath: string; sessionId: string }) => void;
    onDeleteSession?: (e: { workspacePath: string; sessionId: string }) => void;
    onSetWorkspaceColor?: (e: { workspacePath: string; color: string }) => void;
    onDeleteWorkspace?: (e: { workspacePath: string }) => void;
    onAddWorkspace?: () => void;
    onNewTerminal?: () => void;
  } = $props();

  let filterText = $state("");
  let quickSwitcherOpen = $state(false);

  interface FlatRow {
    workspace: Workspace;
    session: Session;
    label: string;
    sortKey: string;
  }

  const flatRows = $derived<FlatRow[]>(
    workspaces.flatMap((w) =>
      w.sessions.map((s) => {
        const title = s.label?.trim() || "(untitled)";
        const label = `${w.name}/${title}`;
        return { workspace: w, session: s, label, sortKey: label.toLowerCase() };
      }),
    ),
  );

  const filteredRows = $derived(
    filterText
      ? flatRows.filter((r) => r.sortKey.includes(filterText.toLowerCase()))
      : flatRows,
  );

  function isSessionOpen(session: Session): boolean {
    return !!session.terminalTabId && openTabIds.has(session.terminalTabId);
  }

  function statusDotColor(session: Session): string {
    if (session.status === "error") return "var(--error)";
    if (session.status === "starting") return "var(--primary)";
    if (session.status === "running") return "var(--secondary)";
    return isSessionOpen(session)
      ? "var(--on-surface-variant)"
      : "var(--outline-variant)";
  }

  function statusDotIcon(session: Session): string {
    if (session.status === "error") return "error";
    return "circle";
  }

  function statusDotFill(session: Session): number {
    if (session.status === "running" || session.status === "starting") return 1;
    return isSessionOpen(session) ? 1 : 0;
  }

  function handleRowClick(row: FlatRow) {
    onSelectSession({
      workspacePath: row.workspace.path,
      sessionId: row.session.id,
    });
  }

  function handleRowKeydown(e: KeyboardEvent, row: FlatRow) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick(row);
    }
  }

  function handleClose(e: Event, row: FlatRow) {
    e.stopPropagation();
    onDeleteSession({
      workspacePath: row.workspace.path,
      sessionId: row.session.id,
    });
  }

  function openQuickSwitcher() {
    quickSwitcherOpen = true;
  }

  function closeQuickSwitcher() {
    quickSwitcherOpen = false;
  }
</script>

<aside class="agent-manager">
  <div class="header">
    <div class="filter-wrap">
      <span class="material-symbols-outlined filter-icon">search</span>
      <input
        class="filter-input"
        type="text"
        placeholder="Filter sessions…"
        bind:value={filterText}
      />
    </div>
    <div class="header-actions">
      <span class="header-label">Sessions</span>
      <div class="header-btn-group">
        <button
          class="hdr-btn"
          title="Open terminal"
          onclick={() => onNewTerminal()}
        >
          <span class="material-symbols-outlined">terminal</span>
        </button>
        <button
          class="hdr-btn"
          title="Settings"
          onclick={() => settingsOpen.set(true)}
        >
          <span class="material-symbols-outlined">settings</span>
        </button>
        <button
          class="hdr-btn"
          title="New session"
          data-testid="open-quick-switcher"
          onclick={openQuickSwitcher}
        >
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>
    </div>
  </div>

  <nav class="session-list">
    {#each filteredRows as row (row.workspace.path + ":" + row.session.id)}
      {@const isActive = row.session.id === activeSessionId &&
        row.workspace.path === activeWorkspacePath}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="session-row"
        class:active={isActive}
        role="button"
        tabindex="0"
        data-testid="session-row"
        onclick={() => handleRowClick(row)}
        onkeydown={(e) => handleRowKeydown(e, row)}
      >
        <span
          class="stripe"
          data-testid="session-stripe"
          style="background: {row.workspace.color ?? 'var(--outline-variant)'}"
        ></span>
        <span
          class="material-symbols-outlined status-dot"
          style="color: {statusDotColor(row.session)}; font-variation-settings: 'FILL' {statusDotFill(row.session)}"
        >
          {statusDotIcon(row.session)}
        </span>
        <span class="session-label" data-testid="session-label">{row.label}</span>
        <span class="diff-badge-slot" data-testid="diff-badge-slot"></span>
        <button
          class="close-btn"
          data-testid="session-close-btn"
          title="Close session"
          onclick={(e) => handleClose(e, row)}
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    {/each}
    {#if filteredRows.length === 0}
      <div class="empty">
        {filterText ? "No matching sessions" : "No sessions yet"}
      </div>
    {/if}
  </nav>
</aside>

{#if quickSwitcherOpen}
  <WorkspaceQuickSwitcher
    workspaces={workspaces.map((w) => ({
      path: w.path,
      name: w.name,
      color: w.color,
      lastUsedAt:
        w.lastUsedAt ??
        w.sessions.reduce((acc, s) => {
          const t = s.createdAt ? Date.parse(s.createdAt) : 0;
          return t > acc ? t : acc;
        }, 0),
    }))}
    onNewSession={(e) => onNewSession(e)}
    onAddFolder={() => onAddWorkspace()}
    onSetWorkspaceColor={(e) => onSetWorkspaceColor(e)}
    onRemoveWorkspace={(e) => onDeleteWorkspace(e)}
    onClose={closeQuickSwitcher}
  />
{/if}

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

  .header {
    padding: 0.75rem 0.75rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .filter-wrap {
    position: relative;
  }

  .filter-icon {
    position: absolute;
    left: 0.5rem;
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
    font-size: 0.72rem;
    font-family: var(--font-body);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem 0.4rem 1.7rem;
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

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.15rem;
  }

  .header-label {
    font-size: 0.7rem;
    font-family: var(--font-display);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface);
    opacity: 0.6;
  }

  .header-btn-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .hdr-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 3px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }

  .hdr-btn:hover {
    color: var(--primary);
  }

  .hdr-btn :global(.material-symbols-outlined) {
    font-size: 1.05rem;
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.3rem 0.35rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .session-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem 0.4rem 0.3rem 0.55rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.12s;
    outline: none;
  }

  .session-row:hover {
    background: color-mix(in srgb, var(--surface-container-high) 60%, transparent);
  }

  .session-row.active {
    background: var(--surface-container-high);
  }

  .session-row:focus-visible {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 60%, transparent);
  }

  .stripe {
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 3px;
    border-radius: 2px;
  }

  .status-dot {
    font-size: 0.55rem !important;
    flex-shrink: 0;
  }

  .session-label {
    font-size: 0.72rem;
    color: var(--on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .diff-badge-slot {
    flex-shrink: 0;
    /* deliberately empty: filled by issue 05 */
  }

  .close-btn {
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
    transition: opacity 0.12s, color 0.12s;
  }

  .session-row:hover .close-btn {
    opacity: 1;
  }

  .close-btn:hover {
    color: var(--error);
  }

  .close-btn :global(.material-symbols-outlined) {
    font-size: 0.85rem;
  }

  .empty {
    padding: 1rem 0.75rem;
    font-size: 0.7rem;
    color: var(--on-surface-variant);
    opacity: 0.6;
    text-align: center;
  }
</style>
