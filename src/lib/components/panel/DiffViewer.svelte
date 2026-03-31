<script lang="ts">
  import { html as diff2htmlHtml } from "diff2html";
  import { ColorSchemeType } from "diff2html/lib/types";
  import "diff2html/bundles/css/diff2html.min.css";
  import type { DiffData } from "../../../types/panel";
  import ChangeSummary from "./ChangeSummary.svelte";

  interface Props {
    data: DiffData | undefined;
    cwd: string;
  }

  let { data, cwd }: Props = $props();

  const diff2htmlOpts = {
    drawFileList: true,
    matching: "lines" as const,
    outputFormat: "line-by-line" as const,
    colorScheme: ColorSchemeType.DARK,
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
  <div class="diff-header">
    <div class="diff-header-left">
      <span class="material-symbols-outlined diff-header-icon">difference</span>
      <span class="diff-header-title">Git Diff</span>
    </div>
  </div>
  {#if data}
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
    <ChangeSummary {data} {cwd} />
  {:else}
    <div class="empty"><span class="empty-text">No diff data available</span></div>
  {/if}
</div>

<style>
  .diff-viewer {
    height: 100%;
    overflow: auto;
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    position: sticky;
    top: 0;
    background: var(--surface-container-low);
    z-index: 1;
  }

  .diff-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .diff-header-icon {
    color: var(--secondary);
    font-size: 1rem;
  }

  .diff-header-title {
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--on-surface);
  }

  .diff-content {
    padding: 0 var(--spacing-2-5) var(--spacing-2-5);
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: calc(100% - 3rem);
    color: var(--on-surface-variant);
  }

  .empty-text {
    font-size: 22px;
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }

  /*
   * Full dark theme override for diff2html.
   * Neon Monolith tonal architecture palette.
   */

  /* Root wrapper */
  .diff-content :global(.d2h-wrapper) {
    background: transparent !important;
    color: var(--on-surface-variant);
  }

  /* File list (collapsible header above each file) */
  .diff-content :global(.d2h-file-list-wrapper) {
    background: var(--surface-container-low) !important;
    border: none !important;
    margin-bottom: 0;
  }

  .diff-content :global(.d2h-file-list-wrapper .d2h-file-list) {
    background: var(--surface-container-low) !important;
  }

  .diff-content :global(.d2h-file-list-line) {
    color: var(--on-surface-variant) !important;
  }

  .diff-content :global(.d2h-file-list-line a) {
    color: var(--primary) !important;
  }

  /* Per-file header bar */
  .diff-content :global(.d2h-file-header) {
    background: var(--surface-container-high) !important;
    border: none !important;
    color: var(--on-surface-variant) !important;
    padding: 10px 14px;
    display: flex;
    align-items: center;
  }

  .diff-content :global(.d2h-file-name-wrapper) {
    background: transparent !important;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .diff-content :global(.d2h-file-name) {
    color: var(--on-surface) !important;
    font-size: 13px;
    font-family: var(--font-mono);
  }

  .diff-content :global(.d2h-file-stats) {
    color: var(--on-surface-variant) !important;
  }

  .diff-content :global(.d2h-file-stats .d2h-lines-added) {
    color: var(--secondary) !important;
    border: none !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-file-stats .d2h-lines-deleted) {
    color: var(--error) !important;
    border: none !important;
    background: transparent !important;
  }

  /* File diff container */
  .diff-content :global(.d2h-file-diff) {
    border: none !important;
    overflow-x: auto;
  }

  .diff-content :global(.d2h-diff-table) {
    border: none !important;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    border-collapse: collapse;
    width: 100%;
  }

  /* Table cells should not overflow or overlap */
  .diff-content :global(.d2h-diff-table td) {
    vertical-align: top;
  }

  /* All code cells */
  .diff-content :global(.d2h-code-line),
  .diff-content :global(.d2h-code-line-ctn) {
    background: var(--surface) !important;
    color: var(--on-surface-variant) !important;
    border: none !important;
    white-space: pre;
    overflow-x: auto;
  }

  .diff-content :global(.d2h-code-line-prefix) {
    color: var(--on-surface-variant) !important;
    background: transparent !important;
    border: none !important;
    user-select: none;
    flex-shrink: 0;
  }

  /* Line numbers */
  .diff-content :global(.d2h-code-linenumber) {
    background: var(--surface-container-low) !important;
    color: color-mix(in srgb, var(--on-surface-variant) 70%, transparent) !important;
    border: none !important;
    min-width: 40px;
    white-space: nowrap;
    user-select: none;
    text-align: right;
    padding-left: 6px;
    padding-right: 6px;
    position: sticky;
    left: 0;
    z-index: 1;
  }

  /* Hunk info (@@ lines) */
  .diff-content :global(.d2h-info) {
    background: var(--surface-container-high) !important;
    color: var(--on-surface-variant) !important;
    border: none !important;
  }

  /* Added lines — secondary at 10% opacity per design spec */
  .diff-content :global(.d2h-ins) {
    background: color-mix(in srgb, var(--secondary-container) 10%, var(--surface)) !important;
    border: none !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-line-ctn) {
    background: transparent !important;
    color: var(--secondary) !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-line-prefix) {
    color: var(--secondary) !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-linenumber) {
    background: color-mix(in srgb, var(--secondary-container) 10%, var(--surface-container-low)) !important;
    color: color-mix(in srgb, var(--secondary) 80%, transparent) !important;
    border: none !important;
  }

  /* Removed lines — error at 10% opacity per design spec */
  .diff-content :global(.d2h-del) {
    background: color-mix(in srgb, var(--error-container) 10%, var(--surface)) !important;
    border: none !important;
  }

  .diff-content :global(.d2h-del .d2h-code-line-ctn) {
    background: transparent !important;
    color: var(--error) !important;
  }

  .diff-content :global(.d2h-del .d2h-code-line-prefix) {
    color: var(--error) !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-del .d2h-code-linenumber) {
    background: color-mix(in srgb, var(--error-container) 10%, var(--surface-container-low)) !important;
    color: color-mix(in srgb, var(--error) 80%, transparent) !important;
    border: none !important;
  }

  /* Inline highlight (word-level diff) */
  .diff-content :global(.d2h-ins ins),
  .diff-content :global(.d2h-change ins) {
    background: color-mix(in srgb, var(--secondary) 28%, transparent) !important;
    text-decoration: none !important;
    border-radius: 2px;
    padding: 1px 0;
  }

  .diff-content :global(.d2h-del del),
  .diff-content :global(.d2h-change del) {
    background: color-mix(in srgb, var(--error) 28%, transparent) !important;
    text-decoration: none !important;
    border-radius: 2px;
    padding: 1px 0;
  }

  /* Collapse/expand button */
  .diff-content :global(.d2h-file-collapse) {
    color: var(--on-surface-variant) !important;
  }

  .diff-content :global(.d2h-file-collapse .d2h-selected) {
    color: var(--on-surface) !important;
  }

  /* Tag badges (renamed, added, deleted, etc.) */
  .diff-content :global(.d2h-tag) {
    background: color-mix(in srgb, var(--secondary) 15%, var(--surface-container-highest)) !important;
    color: var(--secondary) !important;
    border: none !important;
    border-radius: 4px !important;
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    text-transform: uppercase;
  }

  .diff-content :global(.d2h-changed-tag) {
    background: color-mix(in srgb, var(--primary) 15%, var(--surface-container-highest)) !important;
    color: var(--primary) !important;
  }

  .diff-content :global(.d2h-deleted-tag) {
    background: color-mix(in srgb, var(--error) 15%, var(--surface-container-highest)) !important;
    color: var(--error) !important;
  }

  /* Empty diff placeholder */
  .diff-content :global(.d2h-file-side-diff) {
    background: var(--surface) !important;
  }

  /* Side-by-side fallback */
  .diff-content :global(.d2h-file-side-diff .d2h-code-wrapper) {
    background: var(--surface) !important;
  }

  /* Code wrapper */
  .diff-content :global(.d2h-code-wrapper) {
    overflow-x: auto;
    background: var(--surface) !important;
  }

  /* File wrappers — no border, tonal separation */
  .diff-content :global(.d2h-file-wrapper) {
    border: none;
    border-radius: var(--radius-sm);
    margin-bottom: 8px;
    overflow: hidden;
    background: var(--surface-container-high);
  }

  .project-section {
    margin-bottom: var(--spacing-4);
  }

  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-2-5) var(--spacing-5);
    background: var(--surface-container-high);
    position: sticky;
    top: 41px;
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

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--on-surface-variant);
    font-size: 22px;
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }
</style>
