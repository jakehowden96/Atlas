<script lang="ts">
  import {
    buildTree,
    matchesFilter,
    sortedChildren,
    statusLetter,
    type FlatFile,
    type TreeNode,
  } from "../../diff-view";

  interface Props {
    flatFiles: FlatFile[];
    viewedFiles: Set<string>;
    onSelectFile: (key: string) => void;
  }

  let { flatFiles, viewedFiles, onSelectFile }: Props = $props();

  let tree = $derived(buildTree(flatFiles));
  let fileFilter = $state("");

  let collapsedDirs: Set<string> = $state(new Set());
  function toggleDir(path: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(collapsedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedDirs = next;
  }
</script>

<aside class="file-tree">
  <div class="tree-head">
    <span class="tree-title">Files changed</span>
    <span class="tree-count">({flatFiles.length})</span>
  </div>
  <input
    class="tree-filter"
    type="text"
    placeholder="Filter files..."
    bind:value={fileFilter}
  />
  <div class="tree-list">
    {#each sortedChildren(tree) as node (node.path)}
      {#if matchesFilter(node, fileFilter)}
        {@render treeNode(node, 0)}
      {/if}
    {/each}
  </div>
</aside>

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.fileKey}
    {@const key = node.fileKey}
    <button
      class="tree-row file"
      style="padding-left: {8 + depth * 12}px"
      onclick={() => onSelectFile(key)}
    >
      <span class="status-mini status-{node.changeType}" title={node.changeType ?? ""}>{statusLetter(node.changeType)}</span>
      <span class="tree-name" class:viewed-name={viewedFiles.has(key)}>{node.name}</span>
    </button>
  {:else}
    {@const collapsed = !fileFilter.trim() && collapsedDirs.has(node.path)}
    <button
      class="tree-row dir"
      style="padding-left: {8 + depth * 12}px"
      onclick={() => toggleDir(node.path)}
    >
      <span class="material-symbols-outlined dir-chev">{collapsed ? "chevron_right" : "expand_more"}</span>
      <span class="material-symbols-outlined dir-icon">{collapsed ? "folder" : "folder_open"}</span>
      <span class="tree-name dir-name">{node.name}</span>
    </button>
    {#if !collapsed}
      {#each sortedChildren(node) as child (child.path)}
        {#if matchesFilter(child, fileFilter)}
          {@render treeNode(child, depth + 1)}
        {/if}
      {/each}
    {/if}
  {/if}
{/snippet}

<style>
  .file-tree {
    flex: 0 0 220px;
    max-width: 260px;
    min-width: 180px;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--surface-container-low);
    border-right: 1px solid var(--outline-variant);
    display: flex;
    flex-direction: column;
    padding: 8px 0;
  }

  .tree-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 0 12px 6px;
  }
  .tree-title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--on-surface);
    letter-spacing: 0.02em;
  }
  .tree-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--on-surface-variant);
    opacity: 0.7;
  }

  .tree-filter {
    margin: 0 8px 8px;
    padding: 4px 8px;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    color: var(--on-surface);
    font-family: var(--font-mono);
    font-size: 11px;
    outline: none;
  }
  .tree-filter:focus { border-color: var(--primary); }
  .tree-filter::placeholder { color: var(--on-surface-variant); opacity: 0.6; }

  .tree-list {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    min-width: 0;
    transition: background 0.1s, color 0.1s;
  }
  .tree-row:hover { background: var(--surface-container-high); color: var(--on-surface); }
  .tree-row.file { padding-top: 2px; padding-bottom: 2px; }
  .tree-row.dir .dir-name { font-weight: 500; color: var(--on-surface); }
  .dir-chev, .dir-icon { font-size: 0.85rem !important; color: var(--on-surface-variant); }
  .tree-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .viewed-name {
    text-decoration: line-through;
    opacity: 0.45;
  }

  .status-mini {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 9px;
    border-radius: 3px;
    width: 14px;
    height: 14px;
  }
  .status-modified { background: color-mix(in srgb, var(--primary) 18%, transparent); color: var(--primary); }
  .status-added { background: color-mix(in srgb, var(--secondary) 18%, transparent); color: var(--secondary); }
  .status-deleted { background: color-mix(in srgb, var(--error) 18%, transparent); color: var(--error); }
  .status-renamed { background: color-mix(in srgb, var(--tertiary) 18%, transparent); color: var(--tertiary); }

  /* When the panel is narrow, hide the file tree automatically */
  @container (max-width: 540px) {
    .file-tree { display: none; }
  }
</style>
