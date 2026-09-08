<script lang="ts">
  /**
   * ⌘K — the command palette. One ranked list over three sources: the sessions
   * Atlas is running, the workspace's documents and Claude plans, and every
   * open pull request. ⏎ opens the row on the screen that owns it.
   */
  import { fileKey, type FileSource } from "../../files";
  import { rankJumpRows, type JumpRow } from "../../new-session";
  import { buildTiles, compareByAttention, type SessionTile } from "../../overview";
  import { openSession } from "../../session-actions";
  import {
    docEntries,
    fileWs,
    loadDocs,
    loadPlans,
    openFile,
    plans,
  } from "../../stores/files";
  import { liveSessionList } from "../../stores/liveSessions";
  import { prRepos } from "../../stores/prs";
  import { tabs } from "../../stores/terminal";
  import { focusedSessionId, jumpOpen, showView } from "../../stores/view";
  import {
    activeWorkspacePath,
    sessionDiffStats,
    visibleWorkspaces,
  } from "../../stores/workspace";
  import Modal from "../ui/Modal.svelte";

  /** A `JumpRow` plus what ⏎ should do with it, so the ranking stays pure. */
  interface Row extends JumpRow {
    open: () => void;
    /** Sessions only: the right-hand status word. */
    state?: string;
    needsYou?: boolean;
  }

  const STATE_LABEL: Record<string, string> = {
    needsYou: "needs you",
    running: "running",
    error: "error",
    idle: "idle",
  };

  let query = $state("");
  let index = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  let needsInputTabs = $derived(
    new Set($tabs.filter((t) => t.needsInput).map((t) => t.id)),
  );
  let tiles = $derived(
    [...buildTiles($liveSessionList, $visibleWorkspaces, $sessionDiffStats, needsInputTabs)].sort(
      compareByAttention,
    ),
  );

  let sessionRows = $derived<Row[]>(
    tiles.map((tile) => ({
      kind: "session",
      id: tile.sessionUuid,
      label: tile.label,
      context: `${tile.workspaceName || "—"}${tile.branch ? ` · ${tile.branch}` : ""}`,
      haystack: `${tile.workspaceName} ${tile.branch}`,
      state: STATE_LABEL[tile.state] ?? tile.state,
      needsYou: tile.state === "needsYou",
      open: () => openTile(tile),
    })),
  );

  // Directories are skipped: the palette opens things, and a folder has nothing
  // to open. Plans carry an absolute path, workspace docs one relative to
  // `fileWs` — `openFile` takes both as a source plus a path within it.
  let docRows = $derived<Row[]>([
    ...$docEntries
      .filter((entry) => !entry.is_dir)
      .map((entry) => ({
        kind: "doc" as const,
        id: fileKey($fileWs, entry.rel_path),
        label: entry.name,
        context: entry.rel_path,
        haystack: entry.rel_path,
        open: () => openDoc($fileWs, entry.rel_path),
      })),
    ...$plans.map((plan) => ({
      kind: "doc" as const,
      id: fileKey("plans", plan.path),
      label: plan.name,
      context: "Claude plans",
      haystack: plan.path,
      open: () => openDoc("plans", plan.path),
    })),
  ]);

  let prRows = $derived<Row[]>(
    ($prRepos ?? []).flatMap((repo) =>
      repo.prs.map((pr) => ({
        kind: "pr" as const,
        id: `${repo.repo}#${pr.number}`,
        label: pr.title,
        context: `${repo.repo} · #${pr.number}`,
        haystack: `${repo.repo} #${pr.number} ${pr.headRefName} ${pr.author.login}`,
        open: () => showView("prs"),
      })),
    ),
  );

  let all = $derived([...sessionRows, ...docRows, ...prRows]);
  let rows = $derived(rankJumpRows(all, query));
  let selected = $derived(Math.min(index, Math.max(0, rows.length - 1)));

  let wasOpen = false;
  $effect(() => {
    const open = $jumpOpen;
    if (open === wasOpen) return;
    wasOpen = open;
    if (!open) return;
    query = "";
    index = 0;
    // Files fills the doc index when it mounts, and the palette can easily be
    // the first thing to want it — seed it here while it is still empty.
    if ($plans.length === 0) void loadPlans();
    if ($docEntries.length === 0) {
      const ws = $fileWs || $activeWorkspacePath || $visibleWorkspaces[0]?.path || "";
      if (ws !== $fileWs) fileWs.set(ws);
      void loadDocs(ws);
    }
  });

  // `Modal` mounts the input one flush after `jumpOpen` flips, so focus it here
  // rather than immediately after opening.
  $effect(() => {
    if ($jumpOpen) inputEl?.focus();
  });

  function openTile(tile: SessionTile) {
    focusedSessionId.set(tile.atlasSessionId);
    // `openSession` switches to an existing tab, or respawns one that has gone.
    if (tile.workspacePath && tile.atlasSessionId) {
      openSession(tile.workspacePath, tile.atlasSessionId);
    }
    showView("session");
  }

  function openDoc(source: FileSource, path: string) {
    openFile(source, path);
    showView("files");
  }

  function jump(i: number) {
    const row = rows[i];
    if (!row) return;
    jumpOpen.set(false);
    row.open();
  }

  function onKeydown(e: KeyboardEvent) {
    const total = rows.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      jumpOpen.set(false);
    } else if (e.key === "ArrowDown" && total > 0) {
      e.preventDefault();
      index = (selected + 1) % total;
    } else if (e.key === "ArrowUp" && total > 0) {
      e.preventDefault();
      index = (selected - 1 + total) % total;
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      jump(selected);
    }
  }
</script>

<Modal open={$jumpOpen} onClose={() => jumpOpen.set(false)} align="top" width="560px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="jump" onkeydown={onKeydown}>
    <div class="bar">
      <span class="glyph">›_</span>
      <input
        bind:this={inputEl}
        bind:value={query}
        class="input"
        type="text"
        placeholder="Jump to…"
        autocomplete="off"
        spellcheck="false"
      />
      <span class="kbd">esc</span>
    </div>

    <div class="list">
      {#if rows.length === 0}
        <p class="empty">
          {all.length === 0
            ? "Nothing to jump to yet."
            : `Nothing matches “${query}”.`}
        </p>
      {:else}
        {#each rows as row, i (row.id)}
          <button
            type="button"
            class="row"
            class:selected={i === selected}
            onclick={() => jump(i)}
          >
            <span class="pill">{row.kind}</span>
            <span class="text">
              <span class="label">{row.label}</span>
              <span class="meta">{row.context}</span>
            </span>
            {#if row.state}
              <span class="state" class:warn={row.needsYou}>{row.state}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
</Modal>

<style>
  .jump {
    display: flex;
    flex-direction: column;
    max-height: 380px;
  }

  .bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .glyph {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }

  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13.5px;
  }

  .input::placeholder {
    color: var(--muted);
  }

  .kbd {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-xs);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    overflow: auto;
  }

  .empty {
    margin: 6px 8px;
    color: var(--muted);
    font-size: 11.5px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    padding: 8px 10px;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface2);
  }

  .row.selected {
    background: var(--surface2);
    box-shadow: inset 0 0 0 1px var(--border2);
  }

  .pill {
    flex-shrink: 0;
    width: 52px;
    padding: 2px 0;
    border-radius: var(--r-xs);
    background: var(--surface2);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: center;
    text-transform: uppercase;
  }

  .row.selected .pill {
    background: var(--surface3);
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .label {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .state.warn {
    color: var(--warn);
  }
</style>
