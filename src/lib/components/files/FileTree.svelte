<script lang="ts">
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { get } from "svelte/store";
  import {
    buildDocTree,
    fileKey,
    filterDocTree,
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
    docsTruncated,
    expanded,
    fileWs,
    handleExternalChange,
    listError,
    loadDocs,
    loadPlans,
    loadSourceFiles,
    openFile,
    plans,
    removeSource,
    setDoc,
    sourceFiles,
    truncatedSources,
    toggleExpanded,
  } from "../../stores/files";
  import { openFiles, sources } from "../../stores/file-tabs";
  import { openDialogOpen } from "../../stores/view";
  import { activeWorkspacePath, visibleWorkspaces } from "../../stores/workspace";
  import { errorMessage } from "../../ipc-error";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import InlineAlert from "../ui/InlineAlert.svelte";
  import Kbd from "../ui/Kbd.svelte";
  import SearchInput from "../ui/SearchInput.svelte";
  import Select from "../ui/Select.svelte";
  import Tooltip from "../ui/Tooltip.svelte";
  import Tree, { type TreeItem } from "../ui/Tree.svelte";
  import type { TreeKind } from "../ui/TreeRow.svelte";

  // Rename, delete and the context-menu key are reported but not acted on here;
  // phase 75 wires them.
  interface Props {
    onrename?: (id: string) => void;
    ondelete?: (id: string) => void;
    oncontextmenu?: (id: string) => void;
  }
  let { onrename, ondelete, oncontextmenu }: Props = $props();

  /** The tree filter. Matches on file and folder names, not on file contents. */
  let query = $state("");
  let searching = $derived(query.trim().length > 0);
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());

  let tree = $derived(filterDocTree(buildDocTree($docEntries), query));
  let docCount = $derived($docEntries.filter((e) => !e.is_dir).length);
  let workspace = $derived($visibleWorkspaces.find((w) => w.path === $fileWs));
  let myPlans = $derived(
    $plans
      .filter((p) => planWorkspace(p, $visibleWorkspaces) === $fileWs)
      .filter((p) => !searching || matches(planLabel(p.name))),
  );

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
      .map((file) => file.path)
      .filter((path) => !searching || matches(basename(path)));
  });

  /** A registered folder's files, narrowed by the filter. */
  function diskFiles(source: string) {
    const entries = $sourceFiles.get(source) ?? [];
    return searching ? entries.filter((e) => matches(e.name)) : entries;
  }

  const kindOf = (name: string): TreeKind =>
    /\.(md|markdown|mdx|txt)$/i.test(name)
      ? "md"
      : /\.(json|ya?ml|toml|csv)$/i.test(name)
        ? "data"
        : "source";

  /** The workspace docs as the flat list of visible nodes that `Tree` takes. */
  function flattenDocs(nodes: TreeNode[], level: number, parentId: string | null): TreeItem[] {
    return nodes.flatMap((node): TreeItem[] => {
      if (!node.isDir) {
        return [
          {
            id: node.relPath,
            label: node.name,
            level,
            kind: kindOf(node.name),
            expandable: false,
            expanded: false,
            parentId,
            unsaved: dirtyPaths.has(node.relPath),
          },
        ];
      }
      // Every folder is open while filtering: a match inside a collapsed one
      // would otherwise be filtered in and still not on screen.
      const open = searching || $expanded.has(fileKey($fileWs, node.relPath));
      return [
        {
          id: node.relPath,
          label: node.name,
          level,
          kind: "folder",
          expandable: true,
          expanded: open,
          parentId,
          unsaved: !open && hasUnsavedUnder(node, dirtyPaths),
        },
        ...(open ? flattenDocs(node.children, level + 1, node.relPath) : []),
      ];
    });
  }

  /** One-level lists (plans, disk): every row a leaf at level 1. */
  function leaves(source: string, files: { id: string; label: string }[]): TreeItem[] {
    return files.map(({ id, label }) => ({
      id,
      label,
      level: 1,
      kind: kindOf(label),
      expandable: false,
      expanded: false,
      parentId: null,
      unsaved: $dirtyFiles.has(fileKey(source, id)),
    }));
  }
  const diskItems = (entries: { path: string; name: string }[]) =>
    leaves(
      "disk",
      entries.map((e) => ({ id: e.path, label: e.name })),
    );

  let docItems = $derived(flattenDocs(tree, 1, null));
  let planItems = $derived(
    leaves(
      "plans",
      myPlans.map((p) => ({ id: p.path, label: planLabel(p.name) })),
    ).map((item) => ({ ...item, kind: "md" as const })),
  );
  let looseItems = $derived(
    diskItems(looseDiskFiles.map((path) => ({ path, name: basename(path) }))),
  );

  /** The active file's id when it is one of `items`, so only its tree shows a selection. */
  const selectedIn = (source: string, items: TreeItem[]) =>
    items.find((i) => fileKey(source, i.id) === $activeFile)?.id ?? null;

  function openDoc(id: string) {
    if (docItems.find((i) => i.id === id)?.expandable) toggleExpanded(fileKey($fileWs, id));
    else openFile($fileWs, id);
  }

  function toggleDoc(id: string, expand: boolean) {
    if ($expanded.has(fileKey($fileWs, id)) !== expand) toggleExpanded(fileKey($fileWs, id));
  }

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
      const pick = list.find((w) => w.path === $activeWorkspacePath) ?? list[0];
      if (pick) fileWs.set(pick.path);
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
    startDocsWatch(ws).catch((e) =>
      log.warn("files", `startDocsWatch failed for ${ws}: ${errorMessage(e)}`),
    );
    return () => {
      stopDocsWatch(ws).catch((e) =>
        log.warn("files", `stopDocsWatch failed for ${ws}: ${errorMessage(e)}`),
      );
    };
  });

  // An edit made outside Atlas arrives here; re-listing is cheap and keeps the
  // tree correct for creations and deletions as well as edits. An open tab for
  // the changed file is reloaded or flagged as conflicting. `onDocsChanged`
  // resolves asynchronously, so a view torn down before it does must unlisten
  // the moment the handle arrives.
  $effect(() => {
    let stopped = false;
    let unlisten: UnlistenFn | null = null;
    onDocsChanged((workspacePath, relPath) => {
      if (workspacePath !== get(fileWs)) return;
      void loadDocs(workspacePath);
      void handleExternalChange(workspacePath, relPath);
    })
      .then((fn) => {
        if (stopped) fn();
        else unlisten = fn;
      })
      .catch((e) => log.warn("files", `could not listen for doc changes: ${errorMessage(e)}`));
    return () => {
      stopped = true;
      unlisten?.();
    };
  });
</script>

<aside class="tree">
  <div class="ws-row">
    <div class="ws-select">
      <Select
        size="sm"
        aria-label="Workspace"
        placeholder="No workspace"
        options={$visibleWorkspaces.map((w) => ({ id: w.path, label: w.name }))}
        value={$fileWs}
        onChange={(id) => fileWs.set(id)}
      />
    </div>
    <Tooltip text="New note">
      <IconButton icon="add" label="New note" disabled={!$fileWs} onclick={newNote} />
    </Tooltip>
  </div>

  <!-- Filters the three sections below by name. No chord hint on the field,
       because nothing handles one; Ctrl+P is WebView2's print dialog. -->
  <div class="finders">
    <div class="search">
      <SearchInput placeholder="Search files" aria-label="Search files" bind:value={query} />
    </div>
    <Button variant="ghost" size="sm" onclick={() => openDialogOpen.set(true)}>
      Open…
      {#snippet trailing()}<Kbd>{$chords.openFile}</Kbd>{/snippet}
    </Button>
  </div>

  <div class="sections">
    <section>
      <h3 class="label">Claude plans</h3>
      {#if planItems.length > 0}
        <Tree
          label="Claude plans"
          nodes={planItems}
          selectedId={selectedIn("plans", planItems)}
          onopen={(id) => openFile("plans", id)}
          {onrename}
          {ondelete}
          {oncontextmenu}
        />
      {:else}
        <EmptyState compact icon="article" title="No plans yet" />
      {/if}
    </section>

    <section>
      <h3 class="label">{workspace?.name ?? "Workspace"} docs</h3>
      {#if docItems.length > 0}
        <Tree
          label="{workspace?.name ?? 'Workspace'} docs"
          nodes={docItems}
          selectedId={selectedIn($fileWs, docItems)}
          onopen={openDoc}
          ontoggle={toggleDoc}
          {onrename}
          {ondelete}
          {oncontextmenu}
        />
      {:else if !searching}
        <EmptyState compact icon="folder" title="No docs in this workspace" />
      {/if}
    </section>

    <section>
      <h3 class="label">From disk</h3>
      {#each $sources as source (source)}
        {@const items = diskItems(diskFiles(source))}
        <div class="source">
          <span class="source-name" title={source}>{basename(source)}</span>
          <IconButton
            icon="close"
            size="sm"
            label="Forget {basename(source)}"
            onclick={() => void removeSource(source)}
          />
        </div>
        {#if items.length > 0}
          <Tree
            label={basename(source)}
            nodes={items}
            selectedId={selectedIn("disk", items)}
            onopen={(id) => openFile("disk", id)}
            {onrename}
            {ondelete}
            {oncontextmenu}
          />
        {:else}
          <EmptyState compact icon="folder" title="No files here" />
        {/if}
        {#if $truncatedSources.has(source)}
          <p class="note"><Icon name="info" />Only part of this folder is shown</p>
        {/if}
      {/each}
      {#if looseItems.length > 0}
        <Tree
          label="Opened files"
          nodes={looseItems}
          selectedId={selectedIn("disk", looseItems)}
          onopen={(id) => openFile("disk", id)}
          {onrename}
          {ondelete}
          {oncontextmenu}
        />
      {/if}
      {#if $sources.length === 0 && looseItems.length === 0}
        <EmptyState compact icon="folder" title="No folders added" />
        <div class="add">
          <Button variant="ghost" size="sm" onclick={() => openDialogOpen.set(true)}>
            Add a folder
          </Button>
        </div>
      {/if}
    </section>
  </div>

  {#if $listError}<InlineAlert>{$listError}</InlineAlert>{/if}
  <div class="footer">
    {myPlans.length} plans · {docCount} docs{$docsTruncated ? " · list truncated" : ""}
  </div>
</aside>

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
    gap: var(--sp-2);
    padding: var(--sp-2);
    flex-shrink: 0;
  }

  .ws-select {
    flex: 1;
    min-width: 0;
  }

  .finders {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-2) var(--sp-2);
    flex-shrink: 0;
  }

  /* The field takes the column; Open… keeps only what its label needs. */
  .search {
    flex: 1;
    min-width: 0;
  }

  .sections {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-4);
    min-height: 0;
    padding: 0 var(--sp-2) var(--sp-2);
    overflow-y: auto;
  }

  section {
    display: flex;
    flex-direction: column;
  }

  .label {
    margin: 0 0 var(--sp-1) var(--sp-2);
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .source {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    padding: 0 var(--sp-2);
  }

  .source-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    margin: 0 0 0 var(--sp-2);
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .add {
    padding: 0 var(--sp-1);
  }

  .footer {
    flex-shrink: 0;
    padding: var(--sp-2);
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
