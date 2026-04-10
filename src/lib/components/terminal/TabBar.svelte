<script lang="ts">
  import { tabs, activeTabId } from "../../stores/terminal";
  import { workspaces } from "../../stores/workspace";
  import type { TabItem } from "../../../types/terminal";

  const WORKSPACE_COLORS = [
    "#72b1ff", // blue
    "#97f999", // green
    "#ff7167", // coral
    "#e8be7b", // yellow
    "#c48eed", // purple
    "#63bcc6", // cyan
    "#ff9288", // salmon
    "#89ea8d", // lime
    "#94c5ff", // light blue
    "#d8abff", // lavender
  ];

  interface Props {
    onCloseTab: (id: string) => void;
    onSelectTab: (id: string) => void;
    onCloseGroup: (cwd: string) => void;
  }

  let { onCloseTab, onSelectTab, onCloseGroup }: Props = $props();

  interface TabGroup {
    cwd: string;
    label: string;
    color: string;
    tabs: TabItem[];
  }

  const groups = $derived.by(() => {
    const map = new Map<string, TabItem[]>();
    for (const tab of $tabs) {
      const key = (tab.type === "terminal" ? tab.cwd : undefined) ?? "";
      const list = map.get(key) ?? [];
      list.push(tab);
      map.set(key, list);
    }
    const result: TabGroup[] = [];
    let colorIdx = 0;
    for (const [cwd, groupTabs] of map) {
      const label = cwd ? cwd.split("/").filter(Boolean).pop() ?? cwd : "";
      const ws = $workspaces.find((w) => w.path === cwd);
      const color = label
        ? ws?.color ?? WORKSPACE_COLORS[colorIdx % WORKSPACE_COLORS.length]
        : "";
      if (label) colorIdx++;
      result.push({ cwd, label, color, tabs: groupTabs });
    }
    return result;
  });


</script>

<div class="tab-bar">
  {#each groups as group}
    <div
      class="workspace-section"
      style={group.color ? `--group-color: ${group.color}` : ""}
    >
      <div class="section-header" class:section-header-empty={!group.label}>
        {#if group.label}
          <span class="color-dot"></span>
          <span class="group-label">{group.label}</span>
          {#if group.tabs.length > 1}
            <button
              class="group-close"
              title="Close all {group.label} tabs"
              onclick={() => onCloseGroup(group.cwd)}
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          {/if}
        {/if}
      </div>
      <div class="section-tabs">
        {#each group.tabs as tab, i (tab.id)}
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
      </div>
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    gap: 0;
    user-select: none;
    -webkit-user-select: none;
    width: 100%;
  }

  /* ── Workspace section: label on top, tabs below ── */
  .workspace-section {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    border-right: 2px solid var(--group-color, transparent);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px 0;
    min-height: 18px;
  }

  .section-header-empty {
    /* Reserve the same vertical space as a labelled header */
  }

  .section-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px;
  }

  .color-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--group-color);
    flex-shrink: 0;
  }

  .group-label {
    font-size: 11px;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--group-color);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }

  .group-close {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 1px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .group-close:hover {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }

  .group-close :global(.material-symbols-outlined) {
    font-size: 0.85rem;
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
    background: color-mix(in srgb, var(--yellow) 15%, transparent);
    color: var(--yellow);
    animation: pulse-bg 2s ease-in-out infinite;
  }

  .tab.needs-input:hover {
    background: color-mix(in srgb, var(--yellow) 22%, transparent);
    color: var(--yellow);
  }

  @keyframes pulse-bg {
    0%, 100% { background: color-mix(in srgb, var(--yellow) 15%, transparent); }
    50% { background: color-mix(in srgb, var(--yellow) 8%, transparent); }
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
</style>
