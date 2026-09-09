<script lang="ts">
  import {
    buildTree,
    matchesFilter,
    sortedChildren,
    type FlatFile,
    type TreeNode,
  } from "../../diff-view";

  interface Props {
    flatFiles: FlatFile[];
    viewedFiles: Set<string>;
    onSelectFile: (key: string) => void;
    onToggleViewed: (key: string) => void;
  }

  let { flatFiles, viewedFiles, onSelectFile, onToggleViewed }: Props = $props();

  let tree = $derived(buildTree(flatFiles));

  // `TreeNode` carries no counts (diff-view.ts is shared and stays untouched),
  // so the design's trailing "+N" is looked up from the flat list instead.
  let addedByKey = $derived(new Map(flatFiles.map((f) => [f.key, f.addedCount])));

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

<aside class="tree">
  <input
    class="filter"
    type="text"
    placeholder="Filter files…"
    bind:value={fileFilter}
  />
  <div class="list">
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
    <div class="row file" style="padding-left: {6 + depth * 10}px">
      <input
        class="check"
        type="checkbox"
        checked={viewedFiles.has(key)}
        onchange={() => onToggleViewed(key)}
        aria-label="Mark {node.name} viewed"
      />
      <button
        type="button"
        class="name"
        class:viewed={viewedFiles.has(key)}
        title={node.path}
        onclick={() => onSelectFile(key)}
      >{node.name}</button>
      <span class="add">+{addedByKey.get(key) ?? 0}</span>
    </div>
  {:else}
    {@const collapsed = !fileFilter.trim() && collapsedDirs.has(node.path)}
    <button
      type="button"
      class="row dir"
      style="padding-left: {6 + depth * 10}px"
      onclick={() => toggleDir(node.path)}
    >
      <span class="chev" class:open={!collapsed}>›</span>
      <span class="dir-name">{node.name}</span>
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
  .tree {
    display: flex;
    flex-direction: column;
    flex: 0 0 190px;
    width: 190px;
    padding: 8px;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--border);
    font: 11.5px var(--font-mono);
  }

  .filter {
    margin-bottom: 8px;
    padding: 4px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface2);
    color: var(--text);
    font: 11.5px var(--font-mono);
    outline: none;
  }

  /* Replaces the outline above. --border2 was too close to --border to read as
     focus at all, so the focused box takes the accent. */
  .filter:focus-visible {
    border-color: var(--accent);
  }

  .filter::placeholder {
    color: var(--muted);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding-top: 2px;
    padding-bottom: 2px;
    padding-right: 4px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font: 11.5px var(--font-mono);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface2);
  }

  .check {
    flex-shrink: 0;
    width: 11px;
    height: 11px;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text);
    font: 11.5px var(--font-mono);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .name.viewed {
    color: var(--muted);
    text-decoration: line-through;
  }

  .add {
    flex-shrink: 0;
    color: var(--accent);
  }

  .chev {
    flex-shrink: 0;
    width: 11px;
    color: var(--muted);
    text-align: center;
    transition: transform 0.15s ease;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .dir-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
