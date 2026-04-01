<script lang="ts">
  import MarkdownRenderer from "../panel/MarkdownRenderer.svelte";
  import type { MarkdownTab } from "../../../types/terminal";

  interface Props {
    tab: MarkdownTab;
    visible: boolean;
  }

  let { tab, visible }: Props = $props();
</script>

<div class="markdown-container" class:hidden={!visible}>
  <div class="markdown-header">
    <span class="material-symbols-outlined header-icon">description</span>
    <span class="header-title">{tab.title}</span>
    {#if tab.filePath}
      <span class="header-path">{tab.filePath}</span>
    {/if}
  </div>
  <div class="markdown-scroll">
    <MarkdownRenderer content={tab.content} />
  </div>
</div>

<style>
  .markdown-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }

  .markdown-container.hidden {
    visibility: hidden;
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .markdown-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.5rem;
    background: var(--surface-container-low);
    border-bottom: 1px solid var(--outline-variant);
    flex-shrink: 0;
    min-height: 32px;
  }

  .header-icon {
    font-size: 0.9rem;
    color: var(--yellow);
    font-variation-settings: 'FILL' 1;
  }

  .header-title {
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--on-surface);
  }

  .header-path {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--on-surface-variant);
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .markdown-scroll {
    flex: 1;
    overflow: auto;
    padding: 1.5rem 2rem;
  }
</style>
