<script lang="ts">
  import { html as diff2htmlHtml } from "diff2html";
  import "diff2html/bundles/css/diff2html.min.css";
  import type { DiffData } from "../../../types/panel";

  interface Props {
    data: DiffData | undefined;
  }

  let { data }: Props = $props();

  let diffHtml = $derived(
    data?.raw
      ? diff2htmlHtml(data.raw, {
          drawFileList: true,
          matching: "lines",
          outputFormat: "line-by-line",
          colorScheme: "dark",
        })
      : "",
  );
</script>

<div class="diff-viewer">
  {#if data}
    <div class="diff-stats">
      <span class="stat files">{data.files_changed} file{data.files_changed !== 1 ? 's' : ''}</span>
      <span class="stat added">+{data.lines_added}</span>
      <span class="stat removed">-{data.lines_removed}</span>
    </div>
    <div class="diff-content">
      {@html diffHtml}
    </div>
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
    border-bottom: 1px solid #292d3e;
    font-size: 12px;
    position: sticky;
    top: 0;
    background: #1a1b26;
    z-index: 1;
  }

  .stat.files {
    color: #a9b1d6;
  }

  .stat.added {
    color: #9ece6a;
  }

  .stat.removed {
    color: #f7768e;
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
    color: #a9b1d6;
  }

  /* File list (collapsible header above each file) */
  .diff-content :global(.d2h-file-list-wrapper) {
    background: #13141c !important;
    border-color: #292d3e !important;
    margin-bottom: 0;
  }

  .diff-content :global(.d2h-file-list-wrapper .d2h-file-list) {
    background: #13141c !important;
  }

  .diff-content :global(.d2h-file-list-line) {
    color: #a9b1d6 !important;
  }

  .diff-content :global(.d2h-file-list-line a) {
    color: #7aa2f7 !important;
  }

  /* Per-file header bar */
  .diff-content :global(.d2h-file-header) {
    background: #1e2030 !important;
    border-color: #292d3e !important;
    color: #a9b1d6 !important;
    padding: 6px 10px;
  }

  .diff-content :global(.d2h-file-name-wrapper) {
    background: transparent !important;
  }

  .diff-content :global(.d2h-file-name) {
    color: #7aa2f7 !important;
  }

  .diff-content :global(.d2h-file-stats) {
    color: #787c99 !important;
  }

  .diff-content :global(.d2h-file-stats .d2h-lines-added) {
    color: #9ece6a !important;
    border-color: #9ece6a44 !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-file-stats .d2h-lines-deleted) {
    color: #f7768e !important;
    border-color: #f7768e44 !important;
    background: transparent !important;
  }

  /* File diff container */
  .diff-content :global(.d2h-file-diff) {
    border-color: #292d3e !important;
    overflow-x: auto;
  }

  .diff-content :global(.d2h-diff-table) {
    border-color: #292d3e !important;
    font-family: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
    font-size: 12px;
  }

  /* All code cells — nuclear reset of white backgrounds */
  .diff-content :global(.d2h-code-line),
  .diff-content :global(.d2h-code-line-ctn) {
    background: #1a1b26 !important;
    color: #a9b1d6 !important;
    border-color: #292d3e !important;
  }

  .diff-content :global(.d2h-code-line-prefix) {
    color: #444b6a !important;
    background: transparent !important;
    border-color: #292d3e !important;
  }

  /* Line numbers */
  .diff-content :global(.d2h-code-linenumber) {
    background: #13141c !important;
    color: #444b6a !important;
    border-color: #292d3e !important;
  }

  /* Hunk info (@@ lines) */
  .diff-content :global(.d2h-info) {
    background: #1e2030 !important;
    color: #565f89 !important;
    border-color: #292d3e !important;
  }

  /* Added lines */
  .diff-content :global(.d2h-ins) {
    background: #9ece6a15 !important;
    border-color: transparent !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-line-ctn) {
    background: #9ece6a15 !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-line-prefix) {
    color: #9ece6a !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-ins .d2h-code-linenumber) {
    background: #9ece6a12 !important;
    color: #9ece6a88 !important;
    border-color: #292d3e !important;
  }

  /* Removed lines */
  .diff-content :global(.d2h-del) {
    background: #f7768e15 !important;
    border-color: transparent !important;
  }

  .diff-content :global(.d2h-del .d2h-code-line-ctn) {
    background: #f7768e15 !important;
  }

  .diff-content :global(.d2h-del .d2h-code-line-prefix) {
    color: #f7768e !important;
    background: transparent !important;
  }

  .diff-content :global(.d2h-del .d2h-code-linenumber) {
    background: #f7768e12 !important;
    color: #f7768e88 !important;
    border-color: #292d3e !important;
  }

  /* Inline highlight (word-level diff) */
  .diff-content :global(.d2h-ins ins),
  .diff-content :global(.d2h-change ins) {
    background: #9ece6a33 !important;
    text-decoration: none !important;
  }

  .diff-content :global(.d2h-del del),
  .diff-content :global(.d2h-change del) {
    background: #f7768e33 !important;
    text-decoration: none !important;
  }

  /* Collapse/expand button */
  .diff-content :global(.d2h-file-collapse) {
    color: #787c99 !important;
  }

  .diff-content :global(.d2h-file-collapse .d2h-selected) {
    color: #a9b1d6 !important;
  }

  /* Tag badges (renamed, added, deleted, etc.) */
  .diff-content :global(.d2h-tag) {
    background: #292d3e !important;
    color: #787c99 !important;
    border: none !important;
  }

  /* Empty diff placeholder */
  .diff-content :global(.d2h-file-side-diff) {
    background: #1a1b26 !important;
  }

  /* Side-by-side fallback (in case someone switches back) */
  .diff-content :global(.d2h-file-side-diff .d2h-code-wrapper) {
    background: #1a1b26 !important;
  }

  /* Scrollbar styling inside diff */
  .diff-viewer::-webkit-scrollbar {
    width: 8px;
  }

  .diff-viewer::-webkit-scrollbar-track {
    background: #13141c;
  }

  .diff-viewer::-webkit-scrollbar-thumb {
    background: #292d3e;
    border-radius: 4px;
  }

  .diff-viewer::-webkit-scrollbar-thumb:hover {
    background: #3b4261;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #787c99;
    font-size: 14px;
  }
</style>
