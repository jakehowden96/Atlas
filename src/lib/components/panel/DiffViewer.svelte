<script lang="ts">
  import { html as diff2htmlHtml } from "diff2html";
  import "diff2html/bundles/css/diff2html.min.css";
  import type { DiffData } from "../../../types/panel";

  interface Props {
    data: DiffData | undefined;
  }

  let { data }: Props = $props();

  const diff2htmlOpts = {
    drawFileList: true,
    matching: "lines" as const,
    outputFormat: "line-by-line" as const,
    colorScheme: "dark" as const,
  };

  let diffHtml = $derived(
    data?.raw ? diff2htmlHtml(data.raw, diff2htmlOpts) : "",
  );

  let projectHtmls = $derived(
    data?.projects?.map((p) => ({
      ...p,
      html: diff2htmlHtml(p.raw, diff2htmlOpts),
    })) ?? [],
  );
</script>

<div class="diff-viewer">
  {#if data}
    <div class="diff-stats">
      <span class="stat files">{data.files_changed} file{data.files_changed !== 1 ? 's' : ''}</span>
      <span class="stat added">+{data.lines_added}</span>
      <span class="stat removed">-{data.lines_removed}</span>
    </div>
    {#if projectHtmls.length > 0}
      {#each projectHtmls as project}
        <div class="project-section">
          <div class="project-header">
            <span class="project-name">{project.name}</span>
            <span class="project-stats">
              <span class="stat files">{project.files_changed} file{project.files_changed !== 1 ? 's' : ''}</span>
              <span class="stat added">+{project.lines_added}</span>
              <span class="stat removed">-{project.lines_removed}</span>
            </span>
          </div>
          <div class="diff-content">
            {@html project.html}
          </div>
        </div>
      {/each}
    {:else}
      <div class="diff-content">
        {@html diffHtml}
      </div>
    {/if}
  {:else}
    <div class="empty">No diff data available</div>
  {/if}
</div>

<style>
  .diff-viewer {
    height: 100%;
    overflow: auto;
  }

  .diff-stats {
    display: flex;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }

  .stat.files {
    color: var(--fg);
  }

  .stat.added {
    color: var(--green);
  }

  .stat.removed {
    color: var(--red);
  }

  .diff-content {
    padding: 0;
  }

  /*
   * Full dark theme override for diff2html.
   * The default CSS ships with white/light backgrounds on nearly every element.
   * We blanket-reset everything and then re-apply Tokyo Night colours.
   */

  /* Root wrapper */
  .diff-content :global(.d2h-wrapper) {
    background: transparent !important;
    color: var(--fg);
  }

  /* File list (collapsible header above each file) */
  .diff-content :global(.d2h-file-list-wrapper) {
    background: var(--bg-dark) !important;
    border-color: var(--border) !important;
    margin-bottom: 0;
  }

  .diff-content :global(.d2h-file-list-wrapper .d2h-file-list) {
    background: var(--bg-dark) !important;
  }

  .diff-content :global(.d2h-file-list-line) {
    color: var(--fg) !important;
  }

  .diff-content :global(.d2h-file-list-line a) {
    color: var(--blue) !important;
  }

  /* Per-file header bar */
  .diff-content :global(.d2h-file-header) {
    background: var(--bg-light) !important;
    border-color: var(--border) !important;
    color: var(--fg) !important;
    padding: 6px 10px;
  }

  .diff-content :global(.d2h-file-name-wrapper) {
    background: transparent !important;
  }

  .diff-content :global(.d2h-file-name) {
    color: var(--blue) !important;
  }

  .diff-content :global(.d2h-file-stats) {
    color: var(--fg-muted) !important;
  }

  .diff-content :global(.d2h-file-stats .d2h-lines-added) {
    color: var(--green) !important;
    border-color: var(--green)44 !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-file-stats .d2h-lines-deleted) {
    color: var(--red) !important;
    border-color: var(--red)44 !important;
    background: transparent !important;
  }

  /* File diff container */
  .diff-content :global(.d2h-file-diff) {
    border-color: var(--border) !important;
    overflow-x: auto;
  }

  .diff-content :global(.d2h-diff-table) {
    border-color: var(--border) !important;
    font-family: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
    font-size: 12px;
  }

  /* All code cells — nuclear reset of white backgrounds */
  .diff-content :global(.d2h-code-line),
  .diff-content :global(.d2h-code-line-ctn) {
    background: var(--bg) !important;
    color: var(--fg) !important;
    border-color: var(--border) !important;
  }

  .diff-content :global(.d2h-code-line-prefix) {
    color: var(--fg-dim) !important;
    background: transparent !important;
    border-color: var(--border) !important;
  }

  /* Line numbers */
  .diff-content :global(.d2h-code-linenumber) {
    background: var(--bg-dark) !important;
    color: var(--fg-dim) !important;
    border-color: var(--border) !important;
    position: static !important;
    min-width: 40px;
    white-space: nowrap;
  }

  /* Hunk info (@@ lines) */
  .diff-content :global(.d2h-info) {
    background: var(--bg-light) !important;
    color: var(--fg-subtle) !important;
    border-color: var(--border) !important;
  }

  /* Added lines */
  .diff-content :global(.d2h-ins) {
    background: color-mix(in srgb, var(--green) 8%, transparent) !important;
    border-color: transparent !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-line-ctn) {
    background: color-mix(in srgb, var(--green) 8%, transparent) !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-line-prefix) {
    color: var(--green) !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-linenumber) {
    background: color-mix(in srgb, var(--green) 7%, transparent) !important;
    color: color-mix(in srgb, var(--green) 53%, transparent) !important;
    border-color: var(--border) !important;
  }

  /* Removed lines */
  .diff-content :global(.d2h-del) {
    background: color-mix(in srgb, var(--red) 8%, transparent) !important;
    border-color: transparent !important;
  }

  .diff-content :global(.d2h-del .d2h-code-line-ctn) {
    background: color-mix(in srgb, var(--red) 8%, transparent) !important;
  }

  .diff-content :global(.d2h-del .d2h-code-line-prefix) {
    color: var(--red) !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-del .d2h-code-linenumber) {
    background: color-mix(in srgb, var(--red) 7%, transparent) !important;
    color: color-mix(in srgb, var(--red) 53%, transparent) !important;
    border-color: var(--border) !important;
  }

  /* Inline highlight (word-level diff) */
  .diff-content :global(.d2h-ins ins),
  .diff-content :global(.d2h-change ins) {
    background: color-mix(in srgb, var(--green) 20%, transparent) !important;
    text-decoration: none !important;
  }

  .diff-content :global(.d2h-del del),
  .diff-content :global(.d2h-change del) {
    background: color-mix(in srgb, var(--red) 20%, transparent) !important;
    text-decoration: none !important;
  }

  /* Collapse/expand button */
  .diff-content :global(.d2h-file-collapse) {
    color: var(--fg-muted) !important;
  }

  .diff-content :global(.d2h-file-collapse .d2h-selected) {
    color: var(--fg) !important;
  }

  /* Tag badges (renamed, added, deleted, etc.) */
  .diff-content :global(.d2h-tag) {
    background: var(--border) !important;
    color: var(--fg-muted) !important;
    border: none !important;
  }

  /* Empty diff placeholder */
  .diff-content :global(.d2h-file-side-diff) {
    background: var(--bg) !important;
  }

  /* Side-by-side fallback (in case someone switches back) */
  .diff-content :global(.d2h-file-side-diff .d2h-code-wrapper) {
    background: var(--bg) !important;
  }

  /* Scrollbar styling inside diff */
  .diff-viewer::-webkit-scrollbar {
    width: 8px;
  }

  .diff-viewer::-webkit-scrollbar-track {
    background: var(--bg-dark);
  }

  .diff-viewer::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }

  .diff-viewer::-webkit-scrollbar-thumb:hover {
    background: var(--border-light);
  }

  .project-section {
    border-bottom: 2px solid var(--border);
  }

  .project-section:last-child {
    border-bottom: none;
  }

  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--bg-dark);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 33px;
    z-index: 1;
  }

  .project-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-bright);
  }

  .project-stats {
    display: flex;
    gap: 8px;
    font-size: 11px;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--fg-muted);
    font-size: 14px;
  }
</style>
