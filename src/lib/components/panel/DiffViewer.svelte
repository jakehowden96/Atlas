<script lang="ts">
  import { parseDiff } from "../../diff-parser";
  import type { DiffData } from "../../../types/panel";
  import RepositoryClean from "./RepositoryClean.svelte";

  interface Props {
    data: DiffData | undefined;
    cwd: string;
  }

  let { data }: Props = $props();

  let diffView = $state<"local" | "remote">("remote");
  let hasLocalToggle = $derived(!!data?.local_raw && data.local_raw !== data.raw);

  // Reset to remote view when data changes and local toggle becomes unavailable
  $effect(() => {
    if (!hasLocalToggle && diffView !== "remote") {
      diffView = "remote";
    }
  });

  let activeRaw = $derived(
    hasLocalToggle && diffView === "local" ? data!.local_raw! : data?.raw
  );

  // Memoize parseDiff — only re-parse when the raw string actually changes
  let lastRaw = "";
  let lastFiles: ReturnType<typeof parseDiff> = [];
  let files = $derived.by(() => {
    const raw = activeRaw ?? "";
    if (raw === lastRaw) return lastFiles;
    lastRaw = raw;
    lastFiles = raw ? parseDiff(raw) : [];
    return lastFiles;
  });

  let lastProjectsKey = "";
  let lastProjectFiles: { name: string; raw: string; files_changed: number; lines_added: number; lines_removed: number; files: ReturnType<typeof parseDiff> }[] = [];
  let projectFiles = $derived.by(() => {
    const projects = data?.projects;
    if (!projects) return [];
    const key = projects.map((p) => p.raw).join("\0");
    if (key === lastProjectsKey) return lastProjectFiles;
    lastProjectsKey = key;
    lastProjectFiles = projects.map((p) => ({ ...p, files: parseDiff(p.raw) }));
    return lastProjectFiles;
  });

  let isMultiRepo = $derived(projectFiles.length > 0);

  const badgeClass: Record<string, string> = {
    modified: "badge-modified",
    added: "badge-added",
    deleted: "badge-deleted",
    renamed: "badge-renamed",
  };

  // Virtualization: collapse files with > MAX_VISIBLE_LINES behind a toggle
  const MAX_VISIBLE_LINES = 500;
  let expandedFiles: Set<string> = $state(new Set());

  // User-driven collapse, keyed by file path. Independent of the size-based auto-collapse
  // and of the per-file "Viewed" state.
  let userCollapsed: Set<string> = $state(new Set());

  // Per-file "Viewed" state, keyed by file path. Independent of collapse state.
  let viewedFiles: Set<string> = $state(new Set());

  function totalLines(file: { hunks: { lines: { type: string }[] }[] }): number {
    return file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  }

  function toggleExpand(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(expandedFiles);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    expandedFiles = next;
  }

  function toggleUserCollapsed(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(userCollapsed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    userCollapsed = next;
  }

  function toggleViewed(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(viewedFiles);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    viewedFiles = next;
  }

  function shouldCollapse(file: { hunks: { lines: { type: string }[] }[] }, key: string): boolean {
    return totalLines(file) > MAX_VISIBLE_LINES && !expandedFiles.has(key);
  }

  function isCollapsed(file: { hunks: { lines: { type: string }[] }[] }, key: string): boolean {
    return userCollapsed.has(key) || shouldCollapse(file, key);
  }
</script>

<div class="diff-viewer">
  {#if data}
    {#if hasLocalToggle}
      <div class="diff-toggle-bar">
        <button
          class="diff-toggle-pill"
          class:active={diffView === "local"}
          onclick={() => diffView = "local"}
        >Local</button>
        <button
          class="diff-toggle-pill"
          class:active={diffView === "remote"}
          onclick={() => diffView = "remote"}
        >Remote</button>
      </div>
    {/if}
    {#if isMultiRepo}
      {#each projectFiles as project (project.name)}
        <div class="project-section">
          <div class="project-header">
            <span class="project-name">{project.name}</span>
            <span class="project-stats">
              <span class="stat files">{project.files_changed} file{project.files_changed !== 1 ? 's' : ''}</span>
              <span class="stat added">+{project.lines_added}</span>
              <span class="stat removed">-{project.lines_removed}</span>
            </span>
          </div>
          {#each project.files as file (file.newName)}
            {@const fileKey = project.name + "/" + file.newName}
            {@const autoCollapsed = shouldCollapse(file, fileKey)}
            {@const collapsed = isCollapsed(file, fileKey)}
            <div class="file-section" class:collapsed>
              <div class="file-header-row">
                <button
                  type="button"
                  class="file-header"
                  onclick={() => toggleUserCollapsed(fileKey)}
                  aria-expanded={!collapsed}
                >
                  <span class="material-symbols-outlined chevron"
                    >{collapsed ? "chevron_right" : "expand_more"}</span
                  >
                  <span class="material-symbols-outlined file-icon">description</span>
                  <span class="file-name">{file.newName}</span>
                  <span class="badge {badgeClass[file.changeType]}">{file.changeType.toUpperCase()}</span>
                </button>
                <label class="viewed-label">
                  <input
                    type="checkbox"
                    class="viewed-toggle"
                    checked={viewedFiles.has(fileKey)}
                    onchange={() => toggleViewed(fileKey)}
                  />
                  Viewed
                </label>
              </div>
              {#if userCollapsed.has(fileKey)}
                <!-- User collapsed — hide hunks entirely; click header to reopen. -->
              {:else if autoCollapsed}
                <div class="collapsed-notice">
                  <button class="expand-btn" onclick={() => toggleExpand(fileKey)}>
                    Show {totalLines(file)} lines
                  </button>
                </div>
              {:else}
                <div class="file-lines">
                  {#each file.hunks as hunk, hi (hi)}
                    {#each hunk.lines as line, i (i)}
                      {#if line.type === "hunk-header"}
                        <div class="diff-line hunk-info">
                          <div class="line-num"></div>
                          <div class="line-num"></div>
                          <div class="line-content">{hunk.header}</div>
                        </div>
                      {:else if line.type === "add"}
                        <div class="diff-line line-add">
                          <div class="line-num"></div>
                          <div class="line-num num-add">{line.newNum}</div>
                          <div class="line-content content-add"><span class="prefix">+</span><span>{line.content}</span></div>
                        </div>
                      {:else if line.type === "remove"}
                        <div class="diff-line line-remove">
                          <div class="line-num num-remove">{line.oldNum}</div>
                          <div class="line-num"></div>
                          <div class="line-content content-remove"><span class="prefix">-</span><span>{line.content}</span></div>
                        </div>
                      {:else}
                        <div class="diff-line">
                          <div class="line-num">{line.oldNum}</div>
                          <div class="line-num">{line.newNum}</div>
                          <div class="line-content">{line.content}</div>
                        </div>
                      {/if}
                    {/each}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {:else}
      {#each files as file (file.newName)}
        {@const fileKey = file.newName}
        {@const autoCollapsed = shouldCollapse(file, fileKey)}
        {@const collapsed = isCollapsed(file, fileKey)}
        <div class="file-section" class:collapsed>
          <div class="file-header-row">
            <button
              type="button"
              class="file-header"
              onclick={() => toggleUserCollapsed(fileKey)}
              aria-expanded={!collapsed}
            >
              <span class="material-symbols-outlined chevron"
                >{collapsed ? "chevron_right" : "expand_more"}</span
              >
              <span class="material-symbols-outlined file-icon">description</span>
              <span class="file-name">{file.newName}</span>
              <span class="badge {badgeClass[file.changeType]}">{file.changeType.toUpperCase()}</span>
            </button>
            <label class="viewed-label">
              <input
                type="checkbox"
                class="viewed-toggle"
                checked={viewedFiles.has(fileKey)}
                onchange={() => toggleViewed(fileKey)}
              />
              Viewed
            </label>
          </div>
          {#if userCollapsed.has(fileKey)}
            <!-- User collapsed — hide hunks entirely; click header to reopen. -->
          {:else if autoCollapsed}
            <div class="collapsed-notice">
              <button class="expand-btn" onclick={() => toggleExpand(fileKey)}>
                Show {totalLines(file)} lines
              </button>
            </div>
          {:else}
            <div class="file-lines">
              {#each file.hunks as hunk, hi (hi)}
                {#each hunk.lines as line, i (i)}
                  {#if line.type === "hunk-header"}
                    <div class="diff-line hunk-info">
                      <div class="line-num"></div>
                      <div class="line-num"></div>
                      <div class="line-content">{hunk.header}</div>
                    </div>
                  {:else if line.type === "add"}
                    <div class="diff-line line-add">
                      <div class="line-num"></div>
                      <div class="line-num num-add">{line.newNum}</div>
                      <div class="line-content content-add"><span class="prefix">+</span><span>{line.content}</span></div>
                    </div>
                  {:else if line.type === "remove"}
                    <div class="diff-line line-remove">
                      <div class="line-num num-remove">{line.oldNum}</div>
                      <div class="line-num"></div>
                      <div class="line-content content-remove"><span class="prefix">-</span><span>{line.content}</span></div>
                    </div>
                  {:else}
                    <div class="diff-line">
                      <div class="line-num">{line.oldNum}</div>
                      <div class="line-num">{line.newNum}</div>
                      <div class="line-content">{line.content}</div>
                    </div>
                  {/if}
                {/each}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  {:else}
    <RepositoryClean />
  {/if}
</div>

<style>
  .diff-viewer {
    height: 100%;
    overflow: auto;
  }

  .diff-toggle-bar {
    display: flex;
    gap: 2px;
    padding: 8px 10px;
    background: var(--surface-container-low);
    position: sticky;
    top: 0;
    z-index: 2;
  }

  .diff-toggle-pill {
    padding: 4px 12px;
    border: none;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    cursor: pointer;
    background: transparent;
    color: var(--on-surface-variant);
    transition: background 0.15s, color 0.15s;
  }

  .diff-toggle-pill:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .diff-toggle-pill.active {
    background: var(--surface-container-highest);
    color: var(--on-surface);
    font-weight: 600;
  }

  /* File section */
  .file-section {
    margin-bottom: 12px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--outline-variant) 15%, transparent);
    border-radius: 6px;
    content-visibility: auto;
    contain-intrinsic-size: auto none;
  }

  .file-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 0;
    background: var(--surface-container-high);
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: transparent;
    flex: 1;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .file-header:hover {
    background: var(--surface-container-highest);
  }

  .chevron {
    font-size: 16px;
    color: var(--on-surface-variant);
    transition: transform 0.15s ease;
  }

  .viewed-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .viewed-toggle {
    cursor: pointer;
  }

  .file-icon {
    font-size: 14px;
    color: var(--on-surface-variant);
  }

  .file-name {
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--on-surface);
    font-weight: 500;
  }

  /* Change type badges */
  .badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 9px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .badge-modified {
    background: color-mix(in srgb, var(--primary) 15%, var(--surface-container-highest));
    color: var(--primary);
  }

  .badge-added {
    background: color-mix(in srgb, var(--secondary) 15%, var(--surface-container-highest));
    color: var(--secondary);
  }

  .badge-deleted {
    background: color-mix(in srgb, var(--error) 15%, var(--surface-container-highest));
    color: var(--error);
  }

  .badge-renamed {
    background: color-mix(in srgb, var(--tertiary) 15%, var(--surface-container-highest));
    color: var(--tertiary);
  }

  /* Collapsed file notice */
  .collapsed-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: var(--surface);
  }

  .expand-btn {
    padding: 4px 12px;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .expand-btn:hover {
    background: var(--surface-bright);
    color: var(--on-surface);
  }

  /* Diff lines */
  .file-lines {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 24px;
    overflow-x: auto;
    background: var(--surface);
    contain: content;
  }

  .diff-line {
    display: flex;
  }

  .line-num {
    width: 40px;
    flex: none;
    text-align: right;
    padding-right: 8px;
    color: color-mix(in srgb, var(--on-surface-variant) 30%, transparent);
    user-select: none;
    font-size: 11px;
  }

  .line-content {
    flex: 1;
    padding: 0 16px;
    white-space: pre;
    color: color-mix(in srgb, var(--on-surface-variant) 60%, transparent);
  }

  .prefix {
    margin-right: 8px;
    opacity: 0.5;
  }

  /* Hunk header (@@ lines) */
  .hunk-info {
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 5%, transparent);
  }

  .hunk-info .line-content {
    color: var(--on-surface-variant);
    font-size: 11px;
    padding: 4px 16px;
    opacity: 0.6;
  }

  /* Added lines */
  .line-add {
    background: color-mix(in srgb, var(--secondary-container) 10%, var(--surface));
    border-left: 2px solid var(--secondary);
  }

  .num-add {
    color: color-mix(in srgb, var(--secondary) 40%, transparent);
  }

  .content-add {
    color: var(--secondary);
  }

  /* Removed lines */
  .line-remove {
    background: color-mix(in srgb, var(--error-container) 10%, var(--surface));
    border-left: 2px solid var(--error);
  }

  .num-remove {
    color: color-mix(in srgb, var(--error) 40%, transparent);
  }

  .content-remove {
    color: var(--error);
  }

  /* Project sections (multi-repo) */
  .project-section {
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 20%, transparent);
  }

  .project-section:last-child {
    border-bottom: none;
  }

  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: var(--surface-container-high);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .project-name {
    font-size: 13px;
    font-family: var(--font-display);
    color: var(--on-surface);
  }

  .project-stats {
    display: flex;
    gap: 10px;
    font-size: 11px;
    font-family: var(--font-body);
  }

  .stat.added {
    color: var(--secondary);
  }

  .stat.removed {
    color: var(--error);
  }

  .stat.files {
    color: var(--on-surface-variant);
  }
</style>
