<script lang="ts">
  import { tabs, activeTabId, getTabWorkspacePath } from "../../stores/terminal";
  import { workspaces, activeWorkspacePath } from "../../stores/workspace";

  interface Props {
    onCloseTab: (id: string) => void;
    onSelectTab: (id: string) => void;
    onCloseGroup: (cwd: string) => void;
    onSelectWorkspace: (path: string) => void;
  }

  let { onCloseTab, onSelectTab, onCloseGroup, onSelectWorkspace }: Props = $props();

  const workspaceEntries = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const tabsByWs = new Map<string, typeof $tabs>();
    for (const tab of $tabs) {
      const wsPath = getTabWorkspacePath(tab);
      if (!wsPath) continue;
      const list = tabsByWs.get(wsPath) ?? [];
      list.push(tab);
      tabsByWs.set(wsPath, list);
    }
    return $workspaces
      .filter((ws) => tabsByWs.has(ws.path))
      .map((ws) => ({
        path: ws.path,
        label: ws.name.toUpperCase(),
        color: ws.color ?? "",
        needsInput: tabsByWs.get(ws.path)!.some(
          (t) => t.type === "terminal" && t.needsInput,
        ),
      }));
  });

  const filteredTabs = $derived.by(() => {
    const path = $activeWorkspacePath;
    if (!path) return $tabs.filter((t) => !getTabWorkspacePath(t));
    return $tabs.filter((t) => getTabWorkspacePath(t) === path);
  });
</script>

<div class="tab-chrome">
  <!-- Row 1: Workspace navigation -->
  {#if workspaceEntries.length > 0}
    <div class="workspace-bar">
      {#each workspaceEntries as ws (ws.path)}
        <button
          class="workspace-tab"
          class:active={ws.path === $activeWorkspacePath}
          class:needs-input={ws.needsInput && ws.path !== $activeWorkspacePath}
          style={ws.color ? `--ws-color: ${ws.color}` : ""}
          onclick={() => onSelectWorkspace(ws.path)}
        >
          <span class="workspace-label">{ws.label}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Row 2: Session tabs within active workspace -->
  <div class="tab-bar">
    {#each filteredTabs as tab, i (tab.id)}
      <button
        class="tab"
        class:active={tab.id === $activeTabId}
        class:tab-markdown={tab.type === "markdown"}
        class:needs-input={tab.type === "terminal" && tab.needsInput && tab.id !== $activeTabId}
        onclick={() => onSelectTab(tab.id)}
      >
        {#if tab.type === "markdown"}
          <span class="material-symbols-outlined tab-type-icon">description</span>
        {/if}
        <span class="tab-title">{tab.title || `Tab ${i + 1}`}</span>
        <span
          class="tab-close"
          role="button"
          tabindex="0"
          onclick={(e) => {
            e.stopPropagation();
            onCloseTab(tab.id);
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }
          }}
          title="Close"
        >
          &times;
        </span>
      </button>
    {/each}
    {#if filteredTabs.length > 1 && $activeWorkspacePath}
      <button
        class="group-close-btn"
        title="Close all tabs in workspace"
        onclick={() => onCloseGroup($activeWorkspacePath)}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .tab-chrome {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* ── Row 1: Workspace navigation bar ── */
  .workspace-bar {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 4px;
    min-height: 26px;
    user-select: none;
    -webkit-user-select: none;
  }

  .workspace-tab {
    display: flex;
    align-items: center;
    padding: 4px 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--on-surface-variant);
    font-size: 11px;
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: 0.08em;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, background 0.15s;
  }

  .workspace-tab:hover {
    color: var(--on-surface);
    background: var(--surface-container);
  }

  .workspace-tab.active {
    color: var(--ws-color, var(--on-surface));
    background: var(--surface-container-high);
    border-bottom-color: var(--ws-color, var(--primary));
  }

  .workspace-tab.needs-input {
    color: var(--yellow);
    border-bottom-color: var(--yellow);
    animation: pulse-ws 2s ease-in-out infinite;
  }

  @keyframes pulse-ws {
    0%, 100% { background: color-mix(in srgb, var(--yellow) 12%, transparent); }
    50% { background: color-mix(in srgb, var(--yellow) 5%, transparent); }
  }

  /* ── Row 2: Session tabs ── */
  .tab-bar {
    display: flex;
    align-items: center;
    overflow-x: auto;
    gap: 2px;
    padding: 2px 4px;
    min-height: 30px;
    user-select: none;
    -webkit-user-select: none;
    width: 100%;
  }

  /* ── Individual tabs ── */
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-size: 14px;
    font-family: var(--font-mono);
    cursor: pointer;
    white-space: nowrap;
  }

  .tab:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .tab.active {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .tab-markdown {
    color: var(--on-surface-variant);
    opacity: 0.85;
  }

  .tab-markdown .tab-type-icon {
    color: var(--cyan);
  }

  .tab-markdown:hover {
    color: var(--on-surface);
    opacity: 1;
  }

  .tab-markdown.active {
    color: var(--on-surface);
    opacity: 1;
    background: color-mix(in srgb, var(--cyan) 8%, var(--surface-container-high));
  }

  .tab-markdown.active .tab-type-icon {
    color: var(--cyan);
  }

  .tab.needs-input {
    background: color-mix(in srgb, var(--amber) 15%, transparent);
    color: var(--amber);
    animation: pulse-bg 2s ease-in-out infinite;
  }

  .tab.needs-input:hover {
    background: color-mix(in srgb, var(--amber) 22%, transparent);
    color: var(--amber);
  }

  @keyframes pulse-bg {
    0%, 100% { background: color-mix(in srgb, var(--amber) 15%, transparent); }
    50% { background: color-mix(in srgb, var(--amber) 8%, transparent); }
  }

  .tab-type-icon {
    font-size: 0.95rem;
    font-variation-settings: 'FILL' 1;
  }

  .tab-title {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    padding: 0;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
    opacity: 0;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .group-close-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    opacity: 0.4;
    transition: opacity 0.15s, color 0.15s;
    margin-left: auto;
  }

  .group-close-btn:hover {
    opacity: 1;
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }

  .group-close-btn :global(.material-symbols-outlined) {
    font-size: 0.85rem;
  }
</style>
