<script lang="ts">
  import { onDestroy } from "svelte";
  import { buildTiles, compareByAttention, filterByWorkspace } from "../../overview";
  import { addWorkspaceFolder } from "../../session-actions";
  import { liveSessionList } from "../../stores/liveSessions";
  import { tabs } from "../../stores/terminal";
  import { newSessionOpen, wsFilter } from "../../stores/view";
  import { sessionDiffStats, workspaces } from "../../stores/workspace";
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
    buildTiles($liveSessionList, $workspaces, $sessionDiffStats, needsInputTabs),
  );
  let tiles = $derived(
    [...filterByWorkspace(allTiles, $wsFilter)].sort(compareByAttention),
  );

  async function addWorkspace() {
    await addWorkspaceFolder();
  }
</script>

<div class="overview">
  <div class="chips">
    <Chip
      label="All"
      count={allTiles.length}
      selected={$wsFilter === "all"}
      onClick={() => wsFilter.set("all")}
    />
    {#each $workspaces as ws (ws.path)}
      <Chip
        label={ws.name}
        count={allTiles.filter((t) => t.workspacePath === ws.path).length}
        colour={ws.color ?? "var(--surface3)"}
        selected={$wsFilter === ws.path}
        onClick={() => wsFilter.set(ws.path)}
      />
    {/each}
    <!-- The design points this at Settings → Workspaces; that tab arrives in
         phase 11, so until then it opens the folder picker directly. -->
    <Chip label="+ Add workspace" dashed onClick={addWorkspace} />
    <div class="chip-spacer"></div>
    <span class="sorted">Sorted by attention · needs-you first</span>
  </div>

  {#if tiles.length > 0}
    <div class="grid">
      {#each tiles as tile (tile.sessionUuid)}
        <SessionTile {tile} {now} />
      {/each}
    </div>
  {:else}
    <div class="empty">
      <div class="empty-col">
        <div class="glyph">›_</div>
        <div class="empty-title">Nothing running</div>
        <p class="empty-copy">
          Start a Claude session in one of your {$workspaces.length}
          workspace{$workspaces.length === 1 ? "" : "s"}. Sessions you've run before stay listed
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
          <span>⌘N new</span><span>⌘K jump</span><span>⌘, settings</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .overview {
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
</style>
