<script lang="ts">
  /**
   * ⌘K — the command palette. One ranked list over three sources: the sessions
   * Atlas is running, the workspace's documents and Claude plans, and every
   * open pull request. ⏎ opens the row on the screen that owns it.
   */
  import { fileKey, type FileSource } from "../../files";
  import { rankJumpRows, type JumpRow } from "../../new-session";
  import { compareByAttention, type SessionTile } from "../../overview";
  import { openSession } from "../../session-actions";
  import { docEntries, fileWs, loadDocs, loadPlans, openFile, plans } from "../../stores/files";
  import { liveTiles } from "../../stores/liveTiles";
  import { prRepos, prsLoading } from "../../stores/prs";
  import { focusedSessionId, jumpOpen, openNewSession, showView } from "../../stores/view";
  import { activeWorkspacePath, visibleWorkspaces } from "../../stores/workspace";
  import { modLabel, isMacPlatform } from "../../platform";
  import Icon from "../ui/icon/icon.svelte";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Item from "$lib/components/ui/item/index.js";
  import { activateOnKey } from "../../ui/activate";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import StatusMark, { type MarkState } from "../app/common/StatusMark.svelte";

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
  const MARK: Record<string, MarkState> = {
    needsYou: "attention",
    running: "running",
    error: "failing",
    idle: "idle",
  };
  const IS_MAC = isMacPlatform();
  const optionId = (i: number) => `jump-opt-${i}`;

  let query = $state("");
  let index = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  let tiles = $derived([...$liveTiles].sort(compareByAttention));

  let sessionRows = $derived<Row[]>(
    tiles.map((tile) => ({
      kind: "session",
      id: tile.sessionUuid,
      label: tile.label,
      context: `${tile.workspaceName || "—"}${tile.branch ? ` · ${tile.branch}` : ""}`,
      haystack: `${tile.workspaceName} ${tile.branch}`,
      state: tile.state,
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
  let loading = $derived($prsLoading && all.length === 0);
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

  // The arrow keys move `selected` but nothing else moves the list, so past the
  // visible window the highlight — and the row ⏎ acts on — would be off screen.
  // `rows` is read as well as `selected`: it re-ranks on every keystroke in the
  // filter, and the new selection has to be brought into view rather than
  // leaving the list parked where the old one had scrolled it.
  $effect(() => {
    if (!$jumpOpen || !rows[selected]) return;
    // Row 0 scrolls the container itself so the list's top padding comes back;
    // "nearest" would stop at the row's own edge. This is also the reset the
    // palette needs when it reopens, since opening puts `index` back to 0.
    if (selected === 0) {
      if (listEl) listEl.scrollTop = 0;
      return;
    }
    // "nearest" only moves the list when the row is off screen, so stepping
    // through rows already visible does not jitter it, and wrapping round to
    // the last row pulls the bottom of the list into view.
    document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
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
      if ((e.metaKey || e.ctrlKey) && total === 0) {
        jumpOpen.set(false);
        openNewSession();
      } else jump(selected);
    }
  }
</script>

<Dialog.Root open={$jumpOpen} onOpenChange={(o) => { if (!o) (() => jumpOpen.set(false))(); }}>
  <Dialog.Content class="top-[12vh] translate-y-0" aria-label="Jump to">
    <Dialog.Body>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="jump" onkeydown={onKeydown}>
    <div class="bar">
      <Icon name="search" />
      <input
        bind:this={inputEl}
        bind:value={query}
        class="input"
        type="text"
        role="combobox"
        aria-label="Jump to"
        aria-expanded={rows.length > 0}
        aria-controls="jump-list"
        aria-autocomplete="list"
        aria-activedescendant={rows[selected] ? optionId(selected) : undefined}
        placeholder="Jump to…"
        autocomplete="off"
        spellcheck="false"
      />
      <Kbd>esc</Kbd>
    </div>

    <div class="list" id="jump-list" role="listbox" aria-label="Results" bind:this={listEl}>
      {#if loading}
        <Skeleton style="height: var(--h-lg)" class="rounded-md" />
        <Skeleton style="height: var(--h-lg)" class="rounded-md" />
        <Skeleton style="height: var(--h-lg)" class="rounded-md" />
      {:else if rows.length === 0}
        <p class="empty" role="presentation">
          {all.length === 0 ? "Nothing to jump to yet" : `Nothing matches “${query}”`}
        </p>
      {:else}
        {#each rows as row, i (row.id)}
          <Item.Root role="option" id={optionId(i)} aria-selected={i === selected} data-selected={i === selected} tabindex={0} onclick={() => jump(i)} onkeydown={activateOnKey}>
            <span class="pill">{row.kind}</span>
            <span class="text">
              <span class="label">{row.label}</span>
              <span class="meta">{row.context}</span>
            </span>
            {#if row.state}
              <span class="state" class:warn={row.needsYou}>
                <StatusMark state={MARK[row.state] ?? "idle"} />{STATE_LABEL[row.state]}
              </span>
            {/if}
          </Item.Root>
        {/each}
      {/if}
    </div>

    {#if !loading && rows.length === 0 && query.trim()}
      <div class="create">
        <span>Start a new session instead</span>
        <Kbd>{modLabel(IS_MAC)}↵</Kbd>
      </div>
    {/if}
  </div>
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

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

  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  /* Replaces the outline above. The field is borderless because the bar is its
     frame, so focus tints the bar's rule rather than ringing the box. */
  .bar:has(.input:focus-visible) {
    border-bottom-color: var(--success);
  }

  .input::placeholder {
    color: var(--muted-foreground);
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
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .pill {
    flex-shrink: 0;
    width: 52px;
    padding: 2px 0;
    border-radius: var(--radius-xs);
    background: var(--muted);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    text-align: center;
    text-transform: uppercase;
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .label {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .create {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .state.warn {
    color: var(--warning);
  }
</style>
