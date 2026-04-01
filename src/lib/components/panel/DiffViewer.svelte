<script lang="ts">
  import { parseDiff } from "../../diff-parser";
  import type { DiffData } from "../../../types/panel";
  import ChangeSummary from "./ChangeSummary.svelte";

  interface Props {
    data: DiffData | undefined;
    cwd: string;
  }

  let { data, cwd }: Props = $props();

  let diffView: "local" | "all" = $state("all");
  let hasLocalToggle = $derived(!!data?.local_raw && data.local_raw !== data.raw);

  // Reset to all view when data changes and local toggle becomes unavailable
  $effect(() => {
    if (!hasLocalToggle && diffView !== "all") {
      diffView = "all";
    }
  });

  let activeRaw = $derived(
    hasLocalToggle && diffView === "local" ? data!.local_raw! : data?.raw
  );

  let activeDiffData = $derived.by(() => {
    if (!data) return undefined;
    if (hasLocalToggle && diffView === "local") {
      return {
        ...data,
        raw: data.local_raw!,
        files_changed: data.local_files_changed!,
        lines_added: data.local_lines_added!,
        lines_removed: data.local_lines_removed!,
      };
    }
    return data;
  });

  let files = $derived(activeRaw ? parseDiff(activeRaw) : []);

  let projectFiles = $derived(
    data?.projects?.map((p) => ({
      ...p,
      files: parseDiff(p.raw),
    })) ?? [],
  );

  const badgeClass: Record<string, string> = {
    modified: "badge-modified",
    added: "badge-added",
    deleted: "badge-deleted",
    renamed: "badge-renamed",
  };
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
          class:active={diffView === "all"}
          onclick={() => diffView = "all"}
        >All</button>
      </div>
    {/if}
    {#if projectFiles.length > 0}
      {#each projectFiles as project}
        <div class="project-section">
          <div class="project-header">
            <span class="project-name">{project.name}</span>
            <span class="project-stats">
              <span class="stat files">{project.files_changed} file{project.files_changed !== 1 ? 's' : ''}</span>
              <span class="stat added">+{project.lines_added}</span>
              <span class="stat removed">-{project.lines_removed}</span>
            </span>
          </div>
          {#each project.files as file}
            <div class="file-section">
              <div class="file-header">
                <div class="file-header-left">
                  <span class="material-symbols-outlined file-icon">description</span>
                  <span class="file-name">{file.newName}</span>
                  <span class="badge {badgeClass[file.changeType]}">{file.changeType.toUpperCase()}</span>
                </div>
              </div>
              <div class="file-lines">
                {#each file.hunks as hunk}
                  {#each hunk.lines as line}
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
            </div>
          {/each}
        </div>
      {/each}
    {:else}
      {#each files as file}
        <div class="file-section">
          <div class="file-header">
            <div class="file-header-left">
              <span class="material-symbols-outlined file-icon">description</span>
              <span class="file-name">{file.newName}</span>
              <span class="badge {badgeClass[file.changeType]}">{file.changeType.toUpperCase()}</span>
            </div>
          </div>
          <div class="file-lines">
            {#each file.hunks as hunk}
              {#each hunk.lines as line}
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
        </div>
      {/each}
    {/if}
    <ChangeSummary data={activeDiffData!} {cwd} projects={data.projects} />
  {:else}
    <div class="empty"><span class="empty-text">No diff data available</span></div>
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
    margin-bottom: 8px;
    overflow: hidden;
  }

  .file-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--surface-container-high);
  }

  .file-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
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

  /* Diff lines */
  .file-lines {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 24px;
    overflow-x: auto;
    background: var(--surface);
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
    margin-bottom: 16px;
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

  /* Empty state */
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--on-surface-variant);
  }

  .empty-text {
    font-size: 22px;
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }
</style>
