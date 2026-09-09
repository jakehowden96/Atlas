<script lang="ts">
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    buildDocTree,
    fileKey,
    hasUnsavedUnder,
    parseFileKey,
    planWorkspace,
    slugifyPath,
    type TreeNode,
  } from "../../files";
  import { basename } from "../../format";
  import { onDocsChanged, startDocsWatch, stopDocsWatch } from "../../ipc";
  import { log } from "../../logger";
  import { chords } from "../../stores/settings";
  import {
    activeFile,
    dirtyFiles,
    docEntries,
    expanded,
    fileWs,
    loadDocs,
    loadPlans,
    loadSourceFiles,
    openFile,
    openFiles,
    plans,
    removeSource,
    setDoc,
    sourceFiles,
    sources,
    toggleExpanded,
  } from "../../stores/files";
  import { openDialogOpen } from "../../stores/view";
  import { activeWorkspacePath, visibleWorkspaces } from "../../stores/workspace";

  let tree = $derived(buildDocTree($docEntries));
  let docCount = $derived($docEntries.filter((e) => !e.is_dir).length);
  let workspace = $derived($visibleWorkspaces.find((w) => w.path === $fileWs));
  let myPlans = $derived($plans.filter((p) => planWorkspace(p, $visibleWorkspaces) === $fileWs));

  // `hasUnsavedUnder` compares rel paths, so the dirty keys are narrowed to the
  // workspace on show and stripped back down to their paths once per change.
  let dirtyPaths = $derived(
    new Set(
      [...$dirtyFiles]
        .map(parseFileKey)
        .filter((f) => f.source === $fileWs)
        .map((f) => f.path),
    ),
  );

  // Show the plan's random suffix rather than the slugified cwd it starts with;
  // the whole section is already scoped to one workspace. The leading `-` a
  // posix cwd slugifies to is dropped first, as `planWorkspace` does.
  function planLabel(name: string): string {
    const slug = slugifyPath($fileWs);
    const stem = name.replace(/^-+/, "");
    if (!slug || !stem.toLowerCase().startsWith(slug)) return name;
    return stem.slice(slug.length).replace(/^-+/, "") || name;
  }

  // Disk files opened one at a time, listed under the registered folders so a
  // file picked from Open… does not vanish from the tree the moment it is
  // closed and reopened.
  let looseDiskFiles = $derived.by(() => {
    const listed = new Set(
      [...$sourceFiles.values()].flatMap((entries) => entries.map((e) => e.path)),
    );
    return $openFiles
      .map(parseFileKey)
      .filter((file) => file.source === "disk" && !listed.has(file.path))
      .map((file) => file.path);
  });

  /** A new note is an unsaved buffer — nothing reaches disk until ⌘S. */
  function newNote() {
    const ws = $fileWs;
    if (!ws) return;
    const taken = new Set($docEntries.map((e) => e.rel_path));
    for (const key of $openFiles) {
      const file = parseFileKey(key);
      if (file.source === ws) taken.add(file.path);
    }
    let name = "untitled.md";
    for (let n = 2; taken.has(name); n++) name = `untitled-${n}.md`;
    setDoc(fileKey(ws, name), "");
    openFile(ws, name);
  }

  // Show something as soon as there is a workspace to show, and recover when
  // the one on screen is hidden.
  $effect(() => {
    const list = $visibleWorkspaces;
    if (list.length === 0) {
      if ($fileWs) fileWs.set("");
      return;
    }
    if (!list.some((w) => w.path === $fileWs)) {
      fileWs.set((list.find((w) => w.path === $activeWorkspacePath) ?? list[0]).path);
    }
  });

  $effect(() => {
    void loadPlans();
  });

  // Registered folders are restored from settings before this mounts, but
  // nothing reads what is inside them until here.
  $effect(() => {
    void loadSourceFiles($sources);
  });

  // Switching workspaces reloads the tree and moves the watcher with it.
  $effect(() => {
    const ws = $fileWs;
    void loadDocs(ws);
    if (!ws) return;
    startDocsWatch(ws).catch((e) => log.warn("files", `startDocsWatch failed for ${ws}: ${e}`));
    return () => {
      stopDocsWatch(ws).catch((e) => log.warn("files", `stopDocsWatch failed for ${ws}: ${e}`));
    };
  });

  // An edit made outside Atlas arrives here; re-listing is cheap and keeps the
  // tree correct for creations and deletions as well as edits.
  let unlistenDocs: UnlistenFn | null = null;
  onMount(async () => {
    unlistenDocs = await onDocsChanged((workspacePath) => {
      if (workspacePath === get(fileWs)) void loadDocs(workspacePath);
    });
  });
  onDestroy(() => {
    unlistenDocs?.();
    unlistenDocs = null;
  });
</script>

<aside class="tree">
  <div class="ws-row">
    <select class="ws-name" title={$fileWs} aria-label="Workspace" bind:value={$fileWs}>
      {#if $visibleWorkspaces.length === 0}
        <option value="">No workspace</option>
      {/if}
      {#each $visibleWorkspaces as ws (ws.path)}
        <option value={ws.path}>{ws.name}</option>
      {/each}
    </select>
    <button
      type="button"
      class="new-note"
      title="New note"
      aria-label="New note"
      disabled={!$fileWs}
      onclick={newNote}>+</button
    >
  </div>

  <!-- Search is still inert: ⌘K already searches documents from the top bar.
       It is rendered disabled rather than omitted so the column does not shift.
       No chord hint, because nothing handles one: the label read "Ctrl+P" on
       Windows, where that is WebView2's own print dialog. -->
  <div class="finders">
    <button type="button" class="finder" disabled>Search</button>
    <button type="button" class="finder open" onclick={() => openDialogOpen.set(true)}>
      Open… <span class="kbd">{$chords.openFile}</span>
    </button>
  </div>

  <div class="sections">
    <section>
      <h3 class="label">Claude plans</h3>
      {#each myPlans as plan (plan.path)}
        {@const key = fileKey("plans", plan.path)}
        <button
          type="button"
          class="row"
          class:active={$activeFile === key}
          onclick={() => openFile("plans", plan.path)}
          title={plan.path}
        >
          <span class="square"></span>
          <span class="name">{planLabel(plan.name)}</span>
          {#if $dirtyFiles.has(key)}<span class="unsaved"></span>{/if}
        </button>
      {:else}
        <p class="empty">Nothing yet</p>
      {/each}
    </section>

    <section>
      <h3 class="label">{workspace?.name ?? "Workspace"} docs</h3>
      {#each tree as node (node.relPath)}
        {@render row(node, 0)}
      {/each}
    </section>

    <section>
      <h3 class="label">From disk</h3>
      {#each $sources as source (source)}
        <div class="source">
          <span class="source-name" title={source}>{basename(source)}</span>
          <button
            type="button"
            class="forget"
            title="Forget this folder"
            aria-label="Forget {basename(source)}"
            onclick={() => void removeSource(source)}>✕</button
          >
        </div>
        {#each $sourceFiles.get(source) ?? [] as entry (entry.path)}
          {@render diskRow(entry.path, entry.name, 1)}
        {:else}
          <p class="empty nested">Nothing yet</p>
        {/each}
      {/each}
      {#each looseDiskFiles as path (path)}
        {@render diskRow(path, basename(path), 0)}
      {/each}
      {#if $sources.length === 0 && looseDiskFiles.length === 0}
        <p class="empty">Nothing yet</p>
      {/if}
    </section>
  </div>

  <div class="footer">{myPlans.length} plans · {docCount} docs</div>
</aside>

{#snippet diskRow(path: string, name: string, depth: number)}
  {@const key = fileKey("disk", path)}
  <button
    type="button"
    class="row"
    class:active={$activeFile === key}
    style="padding-left: {8 + depth * 14}px"
    title={path}
    onclick={() => openFile("disk", path)}
  >
    <span class="circle"></span>
    <span class="name">{name}</span>
    {#if $dirtyFiles.has(key)}<span class="unsaved"></span>{/if}
  </button>
{/snippet}

{#snippet row(node: TreeNode, depth: number)}
  {@const key = fileKey($fileWs, node.relPath)}
  {#if node.isDir}
    {@const shut = !$expanded.has(key)}
    <button
      type="button"
      class="row"
      style="padding-left: {8 + depth * 14}px"
      onclick={() => toggleExpanded(key)}
    >
      <span class="chev" class:open={!shut}>›</span>
      <span class="name">{node.name}</span>
      {#if shut && hasUnsavedUnder(node, dirtyPaths)}<span class="unsaved"></span>{/if}
    </button>
    {#if !shut}
      {#each node.children as child (child.relPath)}
        {@render row(child, depth + 1)}
      {/each}
    {/if}
  {:else}
    <button
      type="button"
      class="row"
      class:active={$activeFile === key}
      style="padding-left: {8 + depth * 14}px"
      title={node.relPath}
      onclick={() => openFile($fileWs, node.relPath)}
    >
      <span class="circle"></span>
      <span class="name">{node.name}</span>
      {#if dirtyPaths.has(node.relPath)}<span class="unsaved"></span>{/if}
    </button>
  {/if}
{/snippet}

<style>
  .tree {
    display: flex;
    flex: 0 0 240px;
    flex-direction: column;
    width: 240px;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }

  .ws-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 8px;
    flex-shrink: 0;
  }

  .ws-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 12.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .new-note {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--r-sm);
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }

  .new-note:hover:not(:disabled) {
    background: var(--surface2);
    color: var(--text);
  }

  .finders {
    display: flex;
    gap: 6px;
    padding: 0 8px 8px;
    flex-shrink: 0;
  }

  .finder {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface2);
    color: var(--muted);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .finder:disabled {
    opacity: 0.55;
  }

  .finder.open {
    cursor: pointer;
  }

  .finder.open:hover {
    border-color: var(--border2);
    color: var(--text);
  }

  .kbd {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .sections {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    padding: 0 8px 8px;
    overflow-y: auto;
  }

  section {
    display: flex;
    flex-direction: column;
  }

  .label {
    margin: 0 0 4px 8px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .empty {
    margin: 0 0 0 8px;
    color: var(--muted);
    font-size: 11.5px;
  }

  .empty.nested {
    margin-left: 22px;
  }

  .source {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
  }

  .source-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Forgetting a folder only drops the path — nothing on disk is touched. */
  .forget {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 10px;
    line-height: 1;
    opacity: 0;
    cursor: pointer;
  }

  .source:hover .forget {
    opacity: 1;
  }

  .forget:hover {
    color: var(--text);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--text);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface2);
  }

  .row.active {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border2);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chev {
    flex-shrink: 0;
    width: 8px;
    color: var(--muted);
    text-align: center;
    transition: transform 0.15s ease;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .circle,
  .square {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    background: var(--muted);
  }

  .circle {
    border-radius: 50%;
  }

  .unsaved {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text);
  }

  .footer {
    flex-shrink: 0;
    padding: 8px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
  }
</style>
