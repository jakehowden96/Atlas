<script lang="ts">
  import { chord } from "../../platform";
  import { onDestroy } from "svelte";
  import {
    buildTiles,
    filterByWorkspace,
    handleGridKey,
    pinKey,
    tileComparator,
  } from "../../overview";
  import { addWorkspaceFolder } from "../../session-actions";
  import { liveSessionList } from "../../stores/liveSessions";
  import { tabs } from "../../stores/terminal";
  import { overviewOrdering, pinnedSessions, tailTranscripts } from "../../stores/settings";
  import { newSessionOpen, wsFilter } from "../../stores/view";
  import { sessionDiffStats, visibleWorkspaces } from "../../stores/workspace";
  import Chip from "../ui/Chip.svelte";
  import SessionTile from "./SessionTile.svelte";

  // Elapsed is derived from LiveSession.startedAt rather than stored, so the
  // only thing that has to change every second is this clock.
  let now = $state(Date.now());
  const clock = setInterval(() => {
    now = Date.now();
  }, 1000);
  onDestroy(() => clearInterval(clock));

  let needsInputTabs = $derived(
    new Set($tabs.filter((t) => t.needsInput).map((t) => t.id)),
  );
  let allTiles = $derived(
    buildTiles($liveSessionList, $visibleWorkspaces, $sessionDiffStats, needsInputTabs),
  );
  let pinned = $derived(new Set($pinnedSessions));
  let comparator = $derived(tileComparator($overviewOrdering, pinned));
  let tiles = $derived.by(() => {
    const filtered = [...filterByWorkspace(allTiles, $wsFilter)];
    return comparator ? filtered.sort(comparator) : filtered;
  });

  let tilesPerWorkspace = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const tile of allTiles) {
      counts.set(tile.workspacePath, (counts.get(tile.workspacePath) ?? 0) + 1);
    }
    return counts;
  });

  /* Chips are filters, so a workspace with nothing open filters to an empty
     grid — noise, not a control. Only workspaces with a session on screen get
     a chip; the rest stay reachable through the New Session modal. */
  let activeWorkspaces = $derived(
    $visibleWorkspaces.filter((ws) => tilesPerWorkspace.has(ws.path)),
  );

  /* A filter pinned to a workspace that no longer has sessions would strand the
     grid empty with no visible chip to clear it. */
  $effect(() => {
    if ($wsFilter !== "all" && !activeWorkspaces.some((ws) => ws.path === $wsFilter)) {
      wsFilter.set("all");
    }
  });

  /* Roving tabindex: the grid is a single tab stop and the arrows move inside
     it. `focusin` is what keeps this index honest — a click, a Tab and an arrow
     all arrive the same way, including from the buttons nested in a tile. */
  let chipsEl: HTMLDivElement | undefined = $state();
  let gridEl: HTMLDivElement | undefined = $state();
  let focusIndex = $state(0);

  $effect(() => {
    if (focusIndex > tiles.length - 1) focusIndex = Math.max(0, tiles.length - 1);
  });

  /* `auto-fit` picks the track count from the window width, so read it back off
     the laid-out grid. Tracks `auto-fit` collapsed to 0px are not columns. */
  function columnCount(): number {
    if (!gridEl) return 1;
    const tracks = getComputedStyle(gridEl)
      .gridTemplateColumns.split(" ")
      .filter((track) => Number.parseFloat(track) > 0);
    return Math.max(1, tracks.length);
  }

  /* `.grid` is `overflow: auto`, so the tile arrowed onto is routinely off the
     bottom. `focus` would scroll it to the middle; `nearest` just uncovers it. */
  function focusTile(index: number) {
    const el = gridEl?.children[index];
    if (!(el instanceof HTMLElement)) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }

  function chipButtons(): HTMLButtonElement[] {
    return [...(chipsEl?.querySelectorAll("button") ?? [])];
  }

  /** ↑ out of the top row lands on the filter that is actually applied. */
  function focusChip() {
    const at =
      $wsFilter === "all" ? 0 : activeWorkspaces.findIndex((ws) => ws.path === $wsFilter) + 1;
    chipButtons()[Math.max(0, at)]?.focus();
  }

  function onGridFocusIn(e: FocusEvent) {
    const children = [...(gridEl?.children ?? [])];
    const at = children.findIndex((tile) => tile.contains(e.target as Node));
    if (at >= 0) focusIndex = at;
  }

  function onGridKeydown(e: KeyboardEvent) {
    const result = handleGridKey(e, focusIndex, tiles.length, columnCount());
    if (!result.handled) return;
    e.preventDefault();
    if (result.effect === "chips") {
      focusChip();
      return;
    }
    focusIndex = result.index;
    focusTile(result.index);
  }

  /* The chip row is its own tab stop: ←/→ walk it and ↓ drops into the grid. */
  function onChipsKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      if (tiles.length === 0) return;
      e.preventDefault();
      focusTile(focusIndex);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const chips = chipButtons();
    const at = chips.indexOf(e.target as HTMLButtonElement);
    const next = chips[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (at < 0 || !next) return;
    e.preventDefault();
    next.focus();
  }

  const ORDER_LABEL: Record<string, string> = {
    attention: "Sorted by attention · needs-you first",
    workspace: "Grouped by workspace",
    manual: "In the order sessions started",
  };

  async function addWorkspace() {
    await addWorkspaceFolder();
  }
</script>

<div class="sessions">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="chips" bind:this={chipsEl} onkeydown={onChipsKeydown}>
    <Chip
      label="All"
      count={allTiles.length}
      selected={$wsFilter === "all"}
      onClick={() => wsFilter.set("all")}
    />
    {#each activeWorkspaces as ws (ws.path)}
      <Chip
        label={ws.name}
        count={tilesPerWorkspace.get(ws.path) ?? 0}
        colour={ws.color ?? "var(--surface3)"}
        selected={$wsFilter === ws.path}
        onClick={() => wsFilter.set(ws.path)}
      />
    {/each}
    <div class="chip-spacer"></div>
    <span class="sorted">{ORDER_LABEL[$overviewOrdering]}</span>
  </div>

  {#if tiles.length > 0}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grid" bind:this={gridEl} onkeydown={onGridKeydown} onfocusin={onGridFocusIn}>
      {#each tiles as tile, i (tile.sessionUuid)}
        <SessionTile
          {tile}
          {now}
          tailing={$tailTranscripts}
          pinned={pinned.has(pinKey(tile))}
          focused={i === focusIndex}
        />
      {/each}
    </div>
  {:else}
    <div class="empty">
      <div class="empty-col">
        <div class="glyph">›_</div>
        <div class="empty-title">Nothing running</div>
        <p class="empty-copy">
          Start a Claude session in one of your {$visibleWorkspaces.length}
          workspace{$visibleWorkspaces.length === 1 ? "" : "s"}. Sessions you've run before stay listed
          here and can be resumed.
        </p>
        <div class="empty-actions">
          <button type="button" class="primary" onclick={() => newSessionOpen.set(true)}>
            + New session
          </button>
          <button type="button" class="secondary" onclick={addWorkspace}>
            Add workspace folder
          </button>
        </div>
        <div class="hints">
          <span><kbd>{chord("N")}</kbd> new</span>
          <span><kbd>{chord("K")}</kbd> jump</span>
          <span><kbd>{chord(",")}</kbd> settings</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .sessions {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 16px 0;
  }

  .chip-spacer {
    flex: 1;
  }

  .sorted {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .grid {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
    grid-auto-rows: minmax(300px, 1fr);
    gap: 14px;
    min-height: 0;
    padding: 14px 16px 16px;
    overflow: auto;
  }

  /* ── Empty state ─────────────────────────────────────────────────────── */
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
  }

  .empty-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 420px;
    text-align: center;
  }

  .glyph {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 600;
  }

  .empty-title {
    margin-top: 6px;
    font-size: 16px;
    font-weight: 600;
  }

  .empty-copy {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .empty-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .primary,
  .secondary {
    height: 32px;
    padding: 0 14px;
    border-radius: var(--r-lg);
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .primary {
    border: none;
    background: var(--ink);
    color: var(--ink-text);
  }

  .secondary {
    border: 1px solid var(--border2);
    background: var(--surface);
    color: var(--text);
  }

  .hints {
    display: flex;
    gap: 14px;
    margin-top: 14px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .hints span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  /* Without a chip the comma in "Ctrl+," runs into the label after it. */
  .hints kbd {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-xs);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
    color: var(--text);
  }
</style>
