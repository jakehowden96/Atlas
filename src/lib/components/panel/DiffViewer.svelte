<script lang="ts">
  import { parseDiff, type DiffFile } from "../../diff-parser";
  import type { DiffData } from "../../../types/panel";
  import RepositoryClean from "./RepositoryClean.svelte";

  interface Props {
    data: DiffData | undefined;
    cwd: string;
  }

  let { data, cwd }: Props = $props();

  // ---------- Local/Remote toggle (preserves existing behavior) ----------
  let diffView = $state<"local" | "remote">("remote");
  let hasLocalToggle = $derived(!!data?.local_raw && data.local_raw !== data.raw);

  $effect(() => {
    if (!hasLocalToggle && diffView !== "remote") {
      diffView = "remote";
    }
  });

  let activeRaw = $derived(
    hasLocalToggle && diffView === "local" ? data!.local_raw! : data?.raw
  );

  // Memoize parseDiff
  let lastRaw = "";
  let lastFiles: DiffFile[] = [];
  let files = $derived.by(() => {
    const raw = activeRaw ?? "";
    if (raw === lastRaw) return lastFiles;
    lastRaw = raw;
    lastFiles = raw ? parseDiff(raw) : [];
    return lastFiles;
  });

  let lastProjectsKey = "";
  let lastProjectFiles: { name: string; raw: string; files_changed: number; lines_added: number; lines_removed: number; files: DiffFile[] }[] = [];
  let projectFiles = $derived.by(() => {
    const projects = data?.projects;
    if (!projects) return [];
    const key = projects.map((p) => p.raw).join("\0");
    if (key === lastProjectsKey) return lastProjectFiles;
    lastProjectsKey = key;
    lastProjectFiles = projects.map((p) => ({ ...p, files: parseDiff(p.raw) }));
    return lastProjectFiles;
  });

  let isMultiRepo = $derived(projectFiles.length > 0);

  // Flat list of every file with pre-computed +/- counts for unified iteration
  type FlatFile = { key: string; file: DiffFile; addedCount: number; removedCount: number };
  function toFlat(file: DiffFile, key: string): FlatFile {
    let added = 0;
    let removed = 0;
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type === "add") added++;
        else if (l.type === "remove") removed++;
      }
    }
    return { key, file, addedCount: added, removedCount: removed };
  }
  // git diff can emit the same path twice (e.g. .csproj.lscache appearing in
  // both worktree and index). Suffix duplicates so keyed {#each} stays unique.
  function dedupeKeys(items: FlatFile[]): FlatFile[] {
    const seen = new Map<string, number>();
    return items.map((item) => {
      const n = seen.get(item.key) ?? 0;
      seen.set(item.key, n + 1);
      return n === 0 ? item : { ...item, key: `${item.key}#${n}` };
    });
  }
  type ProjectFlat = {
    project: { name: string; files_changed: number; lines_added: number; lines_removed: number };
    items: FlatFile[];
  };
  let projectFlat = $derived<ProjectFlat[]>(
    isMultiRepo
      ? projectFiles.map((p) => ({
          project: { name: p.name, files_changed: p.files_changed, lines_added: p.lines_added, lines_removed: p.lines_removed },
          items: dedupeKeys(p.files.map((f) => toFlat(f, `${p.name}/${f.newName}`))),
        }))
      : []
  );
  let flatFiles = $derived<FlatFile[]>(
    isMultiRepo
      ? projectFlat.flatMap((pf) => pf.items)
      : dedupeKeys(files.map((f) => toFlat(f, f.newName)))
  );

  // ---------- difit-style viewed state ----------
  let viewedFiles: Set<string> = $state(new Set());
  let lastViewedResetKey = "";

  $effect(() => {
    const resetKey = cwd + "\0" + (data?.raw ?? "");
    if (resetKey !== lastViewedResetKey) {
      lastViewedResetKey = resetKey;
      viewedFiles = new Set();
    }
  });

  function toggleViewed(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(viewedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    viewedFiles = next;
  }

  let viewedCount = $derived(flatFiles.filter((f) => viewedFiles.has(f.key)).length);

  // ---------- Toolbar state ----------
  let diffMode = $state<"split" | "unified">("unified");
  let copiedAll = $state(false);

  async function copyAllPrompts() {
    const prompt = flatFiles
      .map((f) => `// File: ${f.key}\n${renderRawForFile(f.file)}`)
      .join("\n\n");
    try {
      await navigator.clipboard?.writeText(prompt);
      copiedAll = true;
      setTimeout(() => (copiedAll = false), 1400);
    } catch {
      // Clipboard unavailable (denied / non-secure context) — silently no-op
    }
  }

  function renderRawForFile(file: DiffFile): string {
    const out: string[] = [];
    for (const hunk of file.hunks) {
      out.push(hunk.header);
      for (const line of hunk.lines) {
        if (line.type === "hunk-header") continue;
        if (line.type === "add") out.push("+" + line.content);
        else if (line.type === "remove") out.push("-" + line.content);
        else out.push(" " + line.content);
      }
    }
    return out.join("\n");
  }

  // ---------- File tree ----------
  type TreeNode = {
    name: string;
    path: string;
    children: Map<string, TreeNode>;
    fileKey?: string;
    changeType?: DiffFile["changeType"];
  };

  function buildTree(items: FlatFile[]): TreeNode {
    const root: TreeNode = { name: "", path: "", children: new Map() };
    for (const item of items) {
      const parts = item.key.split("/");
      let node = root;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        acc = acc ? `${acc}/${part}` : part;
        let child = node.children.get(part);
        if (!child) {
          child = { name: part, path: acc, children: new Map() };
          node.children.set(part, child);
        }
        if (i === parts.length - 1) {
          child.fileKey = item.key;
          child.changeType = item.file.changeType;
        }
        node = child;
      }
    }
    return root;
  }

  let tree = $derived(buildTree(flatFiles));

  let collapsedDirs: Set<string> = $state(new Set());
  function toggleDir(path: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(collapsedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedDirs = next;
  }

  let isFileTreeOpen = $state(true);
  let fileFilter = $state("");

  function matchesFilter(node: TreeNode): boolean {
    if (!fileFilter.trim()) return true;
    const needle = fileFilter.toLowerCase();
    if (node.fileKey) return node.path.toLowerCase().includes(needle);
    for (const child of node.children.values()) {
      if (matchesFilter(child)) return true;
    }
    return false;
  }

  // Sort children: directories first, then files alphabetically
  function sortedChildren(node: TreeNode): TreeNode[] {
    return [...node.children.values()].sort((a, b) => {
      const aIsDir = !a.fileKey;
      const bIsDir = !b.fileKey;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Scroll-to-file when clicking tree entry
  function scrollToFile(key: string) {
    const id = "diff-file-" + cssEscape(key);
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cssEscape(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
  }

  // Status letter for tree icon (GitHub-style)
  function statusLetter(t?: DiffFile["changeType"]): string {
    switch (t) {
      case "added": return "A";
      case "deleted": return "D";
      case "renamed": return "R";
      default: return "M";
    }
  }

  // ---------- Per-file collapse ----------
  // userCollapsed: the user clicked the header to hide a file
  // expandedFiles: the user clicked "Show N lines" to override the size-based auto-collapse
  // Both reset when the diff changes (cheap to redo).
  const MAX_VISIBLE_LINES = 500;
  let userCollapsed: Set<string> = $state(new Set());
  let expandedFiles: Set<string> = $state(new Set());
  let lastCollapseResetKey = "";

  $effect(() => {
    const resetKey = cwd + "\0" + (data?.raw ?? "");
    if (resetKey !== lastCollapseResetKey) {
      lastCollapseResetKey = resetKey;
      userCollapsed = new Set();
      expandedFiles = new Set();
    }
  });

  function totalLines(file: DiffFile): number {
    return file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  }

  function toggleUserCollapsed(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(userCollapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    userCollapsed = next;
  }

  function toggleExpand(key: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(expandedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedFiles = next;
  }

  function shouldCollapse(file: DiffFile, key: string): boolean {
    if (userCollapsed.has(key)) return true;
    return totalLines(file) > MAX_VISIBLE_LINES && !expandedFiles.has(key);
  }

  // Build paired lines for split view: align add/remove rows.
  type SplitRow =
    | { kind: "hunk"; header: string }
    | { kind: "context"; left: { num: number | null; content: string }; right: { num: number | null; content: string } }
    | { kind: "change"; left: { num: number | null; content: string } | null; right: { num: number | null; content: string } | null };

  function toSplitRows(file: DiffFile): SplitRow[] {
    const rows: SplitRow[] = [];
    for (const hunk of file.hunks) {
      rows.push({ kind: "hunk", header: hunk.header });
      let pendingRemoves: { num: number | null; content: string }[] = [];
      let pendingAdds: { num: number | null; content: string }[] = [];
      const flushPair = () => {
        const max = Math.max(pendingRemoves.length, pendingAdds.length);
        for (let i = 0; i < max; i++) {
          rows.push({
            kind: "change",
            left: pendingRemoves[i] ?? null,
            right: pendingAdds[i] ?? null,
          });
        }
        pendingRemoves = [];
        pendingAdds = [];
      };
      for (const line of hunk.lines) {
        if (line.type === "hunk-header") continue;
        if (line.type === "remove") pendingRemoves.push({ num: line.oldNum, content: line.content });
        else if (line.type === "add") pendingAdds.push({ num: line.newNum, content: line.content });
        else {
          flushPair();
          rows.push({
            kind: "context",
            left: { num: line.oldNum, content: line.content },
            right: { num: line.newNum, content: line.content },
          });
        }
      }
      flushPair();
    }
    return rows;
  }
</script>

<div class="diff-viewer">
  {#if data}
    <!-- Top toolbar (difit-style) -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button
          class="icon-btn"
          class:active={isFileTreeOpen}
          onclick={() => (isFileTreeOpen = !isFileTreeOpen)}
          title={isFileTreeOpen ? "Hide file list" : "Show file list"}
        >
          <span class="material-symbols-outlined">{isFileTreeOpen ? "left_panel_close" : "left_panel_open"}</span>
        </button>
        <div class="mode-group" role="group" aria-label="View mode">
          <button class="mode-btn" class:active={diffMode === "split"} onclick={() => (diffMode = "split")}>
            <span class="material-symbols-outlined">view_column</span>
            <span>Side by Side</span>
          </button>
          <button class="mode-btn" class:active={diffMode === "unified"} onclick={() => (diffMode = "unified")}>
            <span class="material-symbols-outlined">notes</span>
            <span>Unified</span>
          </button>
        </div>
      </div>
      <div class="toolbar-right">
        <button class="copy-all-btn" class:copied={copiedAll} onclick={copyAllPrompts} title="Copy all prompts">
          <span class="material-symbols-outlined">{copiedAll ? "check" : "content_copy"}</span>
          <span>{copiedAll ? "Copied" : "Copy All Prompts"}</span>
        </button>
        <div class="viewed-counter">
          <span class="viewed-num">{viewedCount}</span>
          <span class="viewed-sep">/</span>
          <span class="viewed-total">{flatFiles.length}</span>
          <span class="viewed-label">files viewed</span>
        </div>
      </div>
    </div>

    {#if hasLocalToggle}
      <div class="diff-toggle-bar">
        <button class="diff-toggle-pill" class:active={diffView === "local"} onclick={() => diffView = "local"}>Local</button>
        <button class="diff-toggle-pill" class:active={diffView === "remote"} onclick={() => diffView = "remote"}>Remote</button>
      </div>
    {/if}

    <div class="body" class:tree-open={isFileTreeOpen}>
      {#if isFileTreeOpen}
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
              {#if matchesFilter(node)}
                {@render treeNode(node, 0)}
              {/if}
            {/each}
          </div>
        </aside>
      {/if}

      <div class="diff-stream">
        {#if isMultiRepo}
          {#each projectFlat as pf (pf.project.name)}
            <div class="project-section">
              <header class="project-banner">
                <span class="project-name">{pf.project.name}</span>
                <span class="project-stats">
                  <span class="stat files">{pf.project.files_changed} file{pf.project.files_changed !== 1 ? "s" : ""}</span>
                  <span class="stat added">+{pf.project.lines_added}</span>
                  <span class="stat removed">-{pf.project.lines_removed}</span>
                </span>
              </header>
              {#each pf.items as item (item.key)}
                {@render fileCard(item)}
              {/each}
            </div>
          {/each}
        {:else}
          {#each flatFiles as item (item.key)}
            {@render fileCard(item)}
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <RepositoryClean />
  {/if}
</div>

{#snippet fileCard(item: FlatFile)}
  {@const collapsed = shouldCollapse(item.file, item.key)}
  {@const viewed = viewedFiles.has(item.key)}
  {@const isUserCollapsed = userCollapsed.has(item.key)}
  <section
    class="file-card"
    class:viewed
    id={"diff-file-" + cssEscape(item.key)}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <header
      class="file-card-head"
      role="button"
      tabindex="0"
      onclick={() => toggleUserCollapsed(item.key)}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleUserCollapsed(item.key);
        }
      }}
    >
      <div class="head-left">
        <span class="material-symbols-outlined chevron" class:rotated={!isUserCollapsed}>
          chevron_right
        </span>
        <span class="status-dot status-{item.file.changeType}" title={item.file.changeType}>
          {statusLetter(item.file.changeType)}
        </span>
        <span class="file-path" title={item.key}>{item.key}</span>
        <span class="line-stats">
          <span class="add-count">+{item.addedCount}</span>
          <span class="rem-count">-{item.removedCount}</span>
        </span>
      </div>
      <div class="head-right">
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <label class="viewed-toggle" onclick={(e: MouseEvent) => e.stopPropagation()}>
          <input type="checkbox" checked={viewed} onchange={() => toggleViewed(item.key)} />
          <span>Viewed</span>
        </label>
      </div>
    </header>

    {#if collapsed}
      <div class="collapsed-notice">
        <button class="expand-btn" onclick={() => toggleExpand(item.key)}>
          Show {totalLines(item.file)} lines
        </button>
      </div>
    {:else if !viewed}
      {#if diffMode === "split"}
        <div class="diff-lines split">
          {#each toSplitRows(item.file) as row, ri (ri)}
            {#if row.kind === "hunk"}
              <div class="row hunk-row">
                <div class="hunk-cell">{row.header}</div>
              </div>
            {:else if row.kind === "context"}
              <div class="row ctx-row">
                <div class="num">{row.left.num ?? ""}</div>
                <div class="code">{row.left.content}</div>
                <div class="num">{row.right.num ?? ""}</div>
                <div class="code">{row.right.content}</div>
              </div>
            {:else}
              <div class="row chg-row">
                {#if row.left}
                  <div class="num num-rem">{row.left.num ?? ""}</div>
                  <div class="code code-rem"><span class="sign">-</span>{row.left.content}</div>
                {:else}
                  <div class="num empty-num"></div>
                  <div class="code empty-code"></div>
                {/if}
                {#if row.right}
                  <div class="num num-add">{row.right.num ?? ""}</div>
                  <div class="code code-add"><span class="sign">+</span>{row.right.content}</div>
                {:else}
                  <div class="num empty-num"></div>
                  <div class="code empty-code"></div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {:else}
        <div class="diff-lines unified">
          {#each item.file.hunks as hunk, hi (hi)}
            {#each hunk.lines as line, li (li)}
              {#if line.type === "hunk-header"}
                <div class="row hunk-row">
                  <div class="hunk-cell">{hunk.header}</div>
                </div>
              {:else if line.type === "add"}
                <div class="row add-row">
                  <div class="num"></div>
                  <div class="num num-add">{line.newNum ?? ""}</div>
                  <div class="code code-add"><span class="sign">+</span>{line.content}</div>
                </div>
              {:else if line.type === "remove"}
                <div class="row rem-row">
                  <div class="num num-rem">{line.oldNum ?? ""}</div>
                  <div class="num"></div>
                  <div class="code code-rem"><span class="sign">-</span>{line.content}</div>
                </div>
              {:else}
                <div class="row ctx-row-uni">
                  <div class="num">{line.oldNum ?? ""}</div>
                  <div class="num">{line.newNum ?? ""}</div>
                  <div class="code">{line.content}</div>
                </div>
              {/if}
            {/each}
          {/each}
        </div>
      {/if}
    {/if}
  </section>
{/snippet}

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.fileKey}
    {@const key = node.fileKey}
    <button
      class="tree-row file"
      style="padding-left: {8 + depth * 12}px"
      onclick={() => scrollToFile(key)}
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
        {#if matchesFilter(child)}
          {@render treeNode(child, depth + 1)}
        {/if}
      {/each}
    {/if}
  {/if}
{/snippet}

<style>
  /* ============ difit color palette (GitHub-like, themed via tokens) ============ */
  .diff-viewer {
    --diff-add-bg: color-mix(in srgb, var(--secondary) 12%, var(--surface));
    --diff-add-fg: color-mix(in srgb, var(--secondary) 85%, var(--on-surface));
    --diff-add-num-bg: color-mix(in srgb, var(--secondary) 18%, var(--surface-container-low));
    --diff-rem-bg: color-mix(in srgb, var(--error) 10%, var(--surface));
    --diff-rem-fg: color-mix(in srgb, var(--error) 85%, var(--on-surface));
    --diff-rem-num-bg: color-mix(in srgb, var(--error) 18%, var(--surface-container-low));
    --diff-ctx-fg: var(--on-surface);
    --diff-num-fg: color-mix(in srgb, var(--on-surface-variant) 60%, transparent);
    --diff-empty-bg: color-mix(in srgb, var(--surface-container-low) 60%, transparent);

    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    container-type: inline-size;
  }

  /* ============ Toolbar ============ */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    background: var(--surface-container-low);
    border-bottom: 1px solid var(--outline-variant);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--on-surface-variant);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .icon-btn:hover { background: var(--surface-container-high); color: var(--on-surface); }
  .icon-btn.active { color: var(--on-surface); border-color: var(--outline-variant); }
  .icon-btn :global(.material-symbols-outlined) { font-size: 1rem; }

  .mode-group {
    display: inline-flex;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    overflow: hidden;
  }
  .mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .mode-btn :global(.material-symbols-outlined) { font-size: 0.85rem; }
  .mode-btn:hover { background: var(--surface-container-highest); color: var(--on-surface); }
  .mode-btn.active { background: var(--surface-container-highest); color: var(--on-surface); font-weight: 600; }

  .copy-all-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: color-mix(in srgb, var(--secondary) 18%, var(--surface-container-high));
    border: 1px solid color-mix(in srgb, var(--secondary) 40%, var(--outline-variant));
    border-radius: 6px;
    color: var(--secondary);
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .copy-all-btn :global(.material-symbols-outlined) { font-size: 0.85rem; }
  .copy-all-btn:hover { background: color-mix(in srgb, var(--secondary) 28%, var(--surface-container-high)); }
  .copy-all-btn.copied { color: var(--on-surface); border-color: var(--secondary); }

  .viewed-counter {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--on-surface-variant);
  }
  .viewed-num { color: var(--secondary); font-weight: 600; }
  .viewed-sep { opacity: 0.5; }
  .viewed-total { color: var(--on-surface); }
  .viewed-label { margin-left: 4px; opacity: 0.7; }

  /* Local / Remote pills (preserved) */
  .diff-toggle-bar {
    display: flex;
    gap: 2px;
    padding: 6px 10px;
    background: var(--surface-container-low);
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
  }
  .diff-toggle-pill {
    padding: 3px 10px;
    border: none;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    color: var(--on-surface-variant);
  }
  .diff-toggle-pill:hover { background: var(--surface-container-high); color: var(--on-surface); }
  .diff-toggle-pill.active { background: var(--surface-container-highest); color: var(--on-surface); font-weight: 600; }

  /* ============ Body grid: file tree + stream ============ */
  .body {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

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

  .status-mini, .status-dot {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 9px;
    border-radius: 3px;
  }
  .status-mini { width: 14px; height: 14px; }
  .status-dot { width: 18px; height: 18px; font-size: 10px; }
  .status-modified { background: color-mix(in srgb, var(--primary) 18%, transparent); color: var(--primary); }
  .status-added { background: color-mix(in srgb, var(--secondary) 18%, transparent); color: var(--secondary); }
  .status-deleted { background: color-mix(in srgb, var(--error) 18%, transparent); color: var(--error); }
  .status-renamed { background: color-mix(in srgb, var(--tertiary) 18%, transparent); color: var(--tertiary); }

  /* ============ Diff stream ============ */
  .diff-stream {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .project-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .project-banner {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .project-name {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--on-surface);
  }
  .project-stats {
    display: inline-flex;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--on-surface-variant);
  }
  .project-stats .stat.added { color: var(--secondary); }
  .project-stats .stat.removed { color: var(--error); }

  .file-card {
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    background: var(--surface-container-low);
    overflow: hidden;
    flex-shrink: 0;
  }
  .file-card.viewed { opacity: 0.6; }

  .file-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: var(--surface-container-high);
    border-bottom: 1px solid var(--outline-variant);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  .file-card-head:hover {
    background: var(--surface-container-highest);
  }
  .file-card-head:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .head-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .chevron {
    font-size: 1rem !important;
    color: var(--on-surface-variant);
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .chevron.rotated {
    transform: rotate(90deg);
  }

  .file-path {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--on-surface);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .line-stats {
    display: inline-flex;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    flex-shrink: 0;
  }
  .add-count { color: var(--secondary); }
  .rem-count { color: var(--error); }

  .viewed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    color: var(--on-surface-variant);
    font-family: var(--font-body);
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    background: var(--surface-container-low);
  }
  .viewed-toggle input { width: 12px; height: 12px; accent-color: var(--secondary); margin: 0; cursor: pointer; }
  .file-card.viewed .viewed-toggle {
    background: color-mix(in srgb, var(--secondary) 18%, transparent);
    border-color: color-mix(in srgb, var(--secondary) 45%, var(--outline-variant));
    color: var(--secondary);
  }

  /* ============ Diff lines ============ */
  .diff-lines {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
    overflow-x: auto;
    background: var(--surface);
    contain: content;
  }

  .row {
    display: grid;
    align-items: stretch;
  }
  .diff-lines.unified .row {
    grid-template-columns: 40px 40px 1fr;
  }
  .diff-lines.split .row {
    grid-template-columns: 36px 1fr 36px 1fr;
  }
  .diff-lines.split .hunk-row,
  .diff-lines.unified .hunk-row {
    grid-template-columns: 1fr;
  }

  .num {
    text-align: right;
    padding: 0 6px;
    color: var(--diff-num-fg);
    user-select: none;
    font-size: 11px;
    background: var(--surface-container-low);
    border-right: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    white-space: nowrap;
  }
  .code {
    padding: 0 12px;
    white-space: pre;
    color: var(--diff-ctx-fg);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sign {
    display: inline-block;
    width: 12px;
    margin-right: 4px;
    opacity: 0.7;
  }

  /* Hunk header */
  .hunk-row { background: color-mix(in srgb, var(--primary) 8%, var(--surface-container-low)); }
  .hunk-cell {
    padding: 2px 12px;
    color: var(--primary);
    font-size: 11px;
    opacity: 0.85;
    border-top: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
  }

  /* Add / remove rows */
  .add-row .code, .add-row .num-add { background: var(--diff-add-bg); }
  .add-row .num-add { color: var(--secondary); background: var(--diff-add-num-bg); }
  .add-row .code-add { color: var(--diff-add-fg); }

  .rem-row .code, .rem-row .num-rem { background: var(--diff-rem-bg); }
  .rem-row .num-rem { color: var(--error); background: var(--diff-rem-num-bg); }
  .rem-row .code-rem { color: var(--diff-rem-fg); }

  /* Split rows */
  .chg-row .code-add { background: var(--diff-add-bg); color: var(--diff-add-fg); }
  .chg-row .code-rem { background: var(--diff-rem-bg); color: var(--diff-rem-fg); }
  .chg-row .num-add { background: var(--diff-add-num-bg); color: var(--secondary); }
  .chg-row .num-rem { background: var(--diff-rem-num-bg); color: var(--error); }
  .empty-num, .empty-code { background: var(--diff-empty-bg); }

  /* Context row variants */
  .ctx-row .code, .ctx-row-uni .code { color: color-mix(in srgb, var(--on-surface) 80%, transparent); }

  /* Collapsed */
  .collapsed-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: var(--surface);
  }
  .expand-btn {
    padding: 4px 12px;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .expand-btn:hover { background: var(--surface-bright); color: var(--on-surface); }

  /* When the panel is narrow, hide the file tree automatically */
  @container (max-width: 540px) {
    .file-tree { display: none; }
  }
</style>
