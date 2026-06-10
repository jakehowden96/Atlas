<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { settingsOpen } from "../../stores/settings";
  import { sessionDiffStats, type DiffStats } from "../../stores/workspace";
  import WorkspaceQuickSwitcher from "./WorkspaceQuickSwitcher.svelte";

  const dispatch = createEventDispatcher<{
    newSession: { workspacePath: string };
    selectSession: { workspacePath: string; sessionId: string };
    deleteSession: { workspacePath: string; sessionId: string };
    deleteWorkspace: { workspacePath: string };
    selectWorkspace: { workspacePath: string };
    setWorkspaceColor: { workspacePath: string; color: string };
    addWorkspace: undefined;
    newTerminal: undefined;
    selectTerminal: { tabId: string };
    closeTerminal: { tabId: string };
    openPrs: undefined;
  }>();

  interface TerminalRow {
    id: string;
    title: string;
    cwd?: string;
  }

  interface Session {
    id: string;
    label: string;
    status: "complete" | "running" | "error" | "idle" | "starting";
    age: string;
    terminalTabId: string | null;
    createdAt: string;
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
    activeTabId = "",
    openTabIds = new Set<string>(),
    terminalRows = [] as TerminalRow[],
  }: {
    workspaces?: Workspace[];
    activeWorkspacePath?: string;
    activeSessionId?: string;
    activeTabId?: string;
    openTabIds?: Set<string>;
    terminalRows?: TerminalRow[];
  } = $props();

  function isSessionOpen(session: Session): boolean {
    return !!session.terminalTabId && openTabIds.has(session.terminalTabId);
  }

  let filterText = $state("");
  let quickSwitcherOpen = $state(false);

  // Flatten to one entry per session, carrying workspace metadata for the row.
  interface FlatRow {
    workspacePath: string;
    workspaceName: string;
    workspaceColor: string;
    session: Session;
  }

  let flatRows = $derived.by<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const ws of workspaces) {
      for (const s of ws.sessions) {
        rows.push({
          workspacePath: ws.path,
          workspaceName: ws.name,
          workspaceColor: ws.color ?? "#888",
          session: s,
        });
      }
    }
    return rows;
  });

  let filteredRows = $derived(
    filterText
      ? flatRows.filter((r) => {
          const needle = filterText.toLowerCase();
          return (
            r.workspaceName.toLowerCase().includes(needle) ||
            r.session.label.toLowerCase().includes(needle)
          );
        })
      : flatRows,
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

  function getStats(sessionId: string | null): DiffStats | undefined {
    if (!sessionId) return undefined;
    return $sessionDiffStats.get(sessionId);
  }
</script>

<aside class="agent-manager">
  <div class="header">
    <div class="filter-wrap">
      <span class="material-symbols-outlined filter-icon">search</span>
      <input
        class="filter-input"
        type="text"
        placeholder="Filter sessions..."
        bind:value={filterText}
      />
    </div>
  </div>

  {#if terminalRows.length > 0}
    <div class="list-header subtle">
      <span class="list-label">Terminals</span>
    </div>
    <div class="terminal-list">
      {#each terminalRows as t (t.id)}
        {@const isActive = t.id === activeTabId}
        <div
          class="terminal-row"
          class:active={isActive}
          role="button"
          tabindex="0"
          title={t.cwd ?? t.title}
          onclick={() => dispatch("selectTerminal", { tabId: t.id })}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              dispatch("selectTerminal", { tabId: t.id });
            }
          }}
        >
          <span class="material-symbols-outlined term-icon">terminal</span>
          <span class="term-label">{t.title || "Terminal"}</span>
          <button
            class="close-btn"
            title="Close terminal"
            onclick={(e) => {
              e.stopPropagation();
              dispatch("closeTerminal", { tabId: t.id });
            }}
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="list-header">
    <span class="list-label">Sessions</span>
    <div class="list-header-actions">
      <button
        class="hdr-btn"
        title="Open terminal"
        onclick={() => dispatch("newTerminal")}
      >
        <span class="material-symbols-outlined">terminal</span>
      </button>
      <button
        class="hdr-btn"
        title="Pull requests"
        onclick={() => dispatch("openPrs")}
      >
        <span class="material-symbols-outlined">account_tree</span>
      </button>
      <button
        class="hdr-btn"
        title="New session"
        onclick={() => (quickSwitcherOpen = true)}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>
  </div>

  <nav class="session-list">
    {#each filteredRows as row (row.session.id)}
      {@const stats = getStats(row.session.terminalTabId)}
      {@const isActive = row.session.id === activeSessionId}
      <div
        class="session-row"
        class:active={isActive}
        role="button"
        tabindex="0"
        title="{row.workspaceName} / {row.session.label}"
        onclick={() => {
          if (row.workspacePath !== activeWorkspacePath) {
            dispatch("selectWorkspace", { workspacePath: row.workspacePath });
          }
          dispatch("selectSession", {
            workspacePath: row.workspacePath,
            sessionId: row.session.id,
          });
        }}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            dispatch("selectSession", {
              workspacePath: row.workspacePath,
              sessionId: row.session.id,
            });
          }
        }}
      >
        <span class="ws-stripe" style="background: {row.workspaceColor}"></span>

        <div class="row-content">
          <div class="row-primary">
            {#if row.session.status === "starting"}
              <span class="material-symbols-outlined session-spinner">progress_activity</span>
            {:else}
              <span
                class="material-symbols-outlined session-status-icon"
                style="color: {sessionIconColor(row.session)}; font-variation-settings: 'FILL' {sessionIconFill(row.session)}"
              >
                {sessionIcon(row.session)}
              </span>
            {/if}

            <span class="row-session" class:open={isSessionOpen(row.session)}>{row.session.label}</span>

            <button
              class="close-btn"
              title="Close session"
              onclick={(e) => {
                e.stopPropagation();
                dispatch("deleteSession", {
                  workspacePath: row.workspacePath,
                  sessionId: row.session.id,
                });
              }}
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div class="row-secondary">
            <span class="row-ws">{row.workspaceName}</span>
            {#if stats}
              <span class="diff-badge">
                <span class="add">+{stats.linesAdded}</span>
                <span class="rem">−{stats.linesRemoved}</span>
              </span>
            {/if}
          </div>
        </div>
      </div>
    {/each}

    {#if flatRows.length === 0}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon">forum</span>
        <span class="empty-text">No sessions yet</span>
        <button class="empty-cta" onclick={() => (quickSwitcherOpen = true)}>
          Start a session
        </button>
      </div>
    {/if}
  </nav>

  <div class="footer">
    <button
      class="footer-btn"
      title="Settings"
      onclick={() => settingsOpen.set(true)}
    >
      <span class="material-symbols-outlined">settings</span>
      <span class="footer-btn-label">Settings</span>
    </button>
  </div>
</aside>

<WorkspaceQuickSwitcher
  bind:open={quickSwitcherOpen}
  {workspaces}
  on:pickWorkspace={(e) => {
    quickSwitcherOpen = false;
    dispatch("selectWorkspace", { workspacePath: e.detail.workspacePath });
    dispatch("newSession", { workspacePath: e.detail.workspacePath });
  }}
  on:addWorkspace={() => {
    quickSwitcherOpen = false;
    dispatch("addWorkspace");
  }}
  on:setWorkspaceColor={(e) => dispatch("setWorkspaceColor", e.detail)}
  on:deleteWorkspace={(e) => dispatch("deleteWorkspace", e.detail)}
/>

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
    padding: 0.75rem 0.6rem 0.4rem;
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
    font-size: 11px;
    font-family: var(--font-body);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.5rem 0.4rem 1.8rem;
    outline: none;
    transition: border-color 0.15s;
  }

  .filter-input::placeholder { color: var(--on-surface-variant); opacity: 0.5; }
  .filter-input:focus { border-color: color-mix(in srgb, var(--primary) 50%, transparent); }

  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.2rem 0.6rem 0.3rem;
  }
  .list-header.subtle {
    margin-top: 0.2rem;
  }

  .terminal-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 0.3rem 0.3rem;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 25%, transparent);
    margin-bottom: 0.2rem;
  }
  .terminal-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--on-surface-variant);
    transition: background 0.12s, color 0.12s;
  }
  .terminal-row:hover {
    background: color-mix(in srgb, var(--surface-container-high) 60%, transparent);
    color: var(--on-surface);
  }
  .terminal-row.active {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }
  .term-icon {
    font-size: 0.85rem !important;
    flex-shrink: 0;
    color: var(--on-surface-variant);
  }
  .terminal-row.active .term-icon { color: var(--primary); }
  .term-label {
    flex: 1;
    min-width: 0;
    font-size: 0.72rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .terminal-row .close-btn { opacity: 0; }
  .terminal-row:hover .close-btn { opacity: 1; }
  .list-label {
    font-size: 10px;
    font-family: var(--font-display);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-surface);
    opacity: 0.65;
  }
  .list-header-actions {
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
    transition: color 0.15s, background 0.15s;
  }
  .hdr-btn:hover { color: var(--primary); background: var(--surface-container-high); }
  .hdr-btn :global(.material-symbols-outlined) { font-size: 1rem; }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.2rem 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .session-row {
    position: relative;
    display: flex;
    align-items: stretch;
    padding: 0.4rem 0.4rem 0.4rem 0.65rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.12s;
  }
  .session-row:hover { background: color-mix(in srgb, var(--surface-container-high) 60%, transparent); }
  .session-row.active { background: var(--surface-container-high); }

  .ws-stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    border-top-left-radius: var(--radius-sm);
    border-bottom-left-radius: var(--radius-sm);
  }

  .row-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row-primary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .row-secondary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding-left: calc(0.7rem + 4px); /* align under session label past the status icon */
    min-width: 0;
  }

  .session-status-icon {
    font-size: 0.7rem !important;
    flex-shrink: 0;
  }

  .session-spinner {
    font-size: 0.75rem !important;
    color: var(--primary);
    flex-shrink: 0;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .row-session {
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    font-weight: 500;
  }
  .row-session.open { color: var(--on-surface); }

  .row-ws {
    font-size: 0.65rem;
    color: var(--on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
    opacity: 0.75;
  }

  .diff-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 9px;
    flex-shrink: 0;
    opacity: 0.85;
  }
  .diff-badge .add { color: var(--secondary); }
  .diff-badge .rem { color: var(--error); }

  .close-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 2px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }
  .session-row:hover .close-btn { opacity: 1; }
  .close-btn:hover { color: var(--error); }
  .close-btn :global(.material-symbols-outlined) { font-size: 0.85rem; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 2rem 0.5rem;
    color: var(--on-surface-variant);
    text-align: center;
  }
  .empty-icon { font-size: 1.8rem !important; opacity: 0.4; }
  .empty-text { font-size: 0.7rem; opacity: 0.65; }
  .empty-cta {
    margin-top: 0.4rem;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface);
    font-family: var(--font-body);
    font-size: 0.7rem;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    transition: background 0.15s;
  }
  .empty-cta:hover { background: var(--surface-container-highest); }

  .footer {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    padding: 0.5rem 0.6rem 0.75rem;
    margin-top: 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--outline-variant) 25%, transparent);
  }

  .footer-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-body);
    font-size: 0.75rem;
    transition: color 0.15s, background 0.15s;
  }
  .footer-btn:hover {
    color: var(--on-surface);
    background: color-mix(in srgb, var(--surface-container-high) 60%, transparent);
  }
  .footer-btn :global(.material-symbols-outlined) { font-size: 1rem; }
  .footer-btn-label {
    font-weight: 500;
  }
</style>
