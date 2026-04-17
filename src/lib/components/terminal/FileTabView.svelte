<script lang="ts">
  import MarkdownRenderer from "../panel/MarkdownRenderer.svelte";
  import CodeRenderer from "./CodeRenderer.svelte";
  import type { FileTab } from "../../../types/terminal";
  import { updateFileContent, setFileEditing } from "../../stores/terminal";
  import { saveActiveFile } from "../../file-save";

  interface Props {
    tab: FileTab;
    visible: boolean;
  }

  let { tab, visible }: Props = $props();

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    updateFileContent(tab.id, target.value);
  }

  function toggleEdit() {
    setFileEditing(tab.id, !tab.editing);
  }
</script>

<div class="file-container" class:hidden={!visible}>
  <div class="file-header">
    <span class="material-symbols-outlined header-icon">
      {tab.language === "markdown" ? "description" : "code"}
    </span>
    <span class="header-title">
      {tab.dirty ? "* " : ""}{tab.title}
    </span>
    {#if tab.filePath}
      <span class="header-path">{tab.filePath}</span>
    {/if}
    <div class="header-actions">
      <button
        class="header-btn"
        onclick={toggleEdit}
        title={tab.editing ? "View" : "Edit"}
      >
        <span class="material-symbols-outlined">
          {tab.editing ? "visibility" : "edit"}
        </span>
      </button>
      {#if tab.dirty}
        <button
          class="header-btn save-btn"
          onclick={() => saveActiveFile()}
          title="Save (Ctrl+S)"
        >
          <span class="material-symbols-outlined">save</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="file-body">
    {#if tab.language === "markdown" && tab.editing}
      <div class="split-view">
        <div class="editor-pane">
          <textarea
            class="editor-textarea"
            value={tab.content}
            oninput={handleInput}
            spellcheck={false}
          ></textarea>
        </div>
        <div class="preview-pane">
          <MarkdownRenderer content={tab.content} />
        </div>
      </div>
    {:else if tab.language === "markdown"}
      <div class="markdown-scroll">
        <MarkdownRenderer content={tab.content} />
      </div>
    {:else if tab.editing}
      <textarea
        class="editor-textarea full"
        value={tab.content}
        oninput={handleInput}
        spellcheck={false}
      ></textarea>
    {:else}
      <div class="code-scroll">
        <CodeRenderer content={tab.content} language={tab.language} />
      </div>
    {/if}
  </div>
</div>

<style>
  .file-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }

  .file-container.hidden {
    visibility: hidden;
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .file-header {
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
    color: var(--cyan);
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .header-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: background 0.15s, color 0.15s;
  }

  .header-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .header-btn .material-symbols-outlined {
    font-size: 1rem;
  }

  .save-btn:hover {
    color: var(--primary);
  }

  .file-body {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .markdown-scroll {
    flex: 1;
    overflow: auto;
    padding: 1.5rem 2rem;
  }

  .code-scroll {
    flex: 1;
    overflow: auto;
  }

  /* Split view for markdown editing */
  .split-view {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane {
    flex: 1;
    display: flex;
    border-right: 1px solid var(--outline-variant);
    overflow: hidden;
  }

  .preview-pane {
    flex: 1;
    overflow: auto;
    padding: 1.5rem 2rem;
  }

  .editor-textarea {
    width: 100%;
    height: 100%;
    resize: none;
    border: none;
    outline: none;
    background: var(--surface-container);
    color: var(--on-surface);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.6;
    padding: 1rem;
    tab-size: 2;
  }

  .editor-textarea.full {
    flex: 1;
  }

  .editor-textarea::placeholder {
    color: var(--on-surface-variant);
  }
</style>
