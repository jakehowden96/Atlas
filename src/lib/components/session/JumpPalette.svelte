<script lang="ts">
  /**
   * ⌘K — a session jumper, not a command palette. A flat filtered list of the
   * sessions Atlas is running; ⏎ focuses one in Session view.
   */
  import { buildTiles, compareByAttention } from "../../overview";
  import { filterJumpRows } from "../../new-session";
  import { openSession } from "../../session-actions";
  import { liveSessionList } from "../../stores/liveSessions";
  import { tabs } from "../../stores/terminal";
  import { focusedSessionId, jumpOpen, showView } from "../../stores/view";
  import { sessionDiffStats, workspaces } from "../../stores/workspace";
  import Modal from "../ui/Modal.svelte";

  let query = $state("");
  let index = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  let needsInputTabs = $derived(
    new Set($tabs.filter((t) => t.needsInput).map((t) => t.id)),
  );
  let tiles = $derived(
    [...buildTiles($liveSessionList, $workspaces, $sessionDiffStats, needsInputTabs)].sort(
      compareByAttention,
    ),
  );
  let rows = $derived(filterJumpRows(tiles, query));
  let selected = $derived(Math.min(index, Math.max(0, rows.length - 1)));

  let wasOpen = false;
  $effect(() => {
    const open = $jumpOpen;
    if (open === wasOpen) return;
    wasOpen = open;
    if (!open) return;
    query = "";
    index = 0;
  });

  // `Modal` mounts the input one flush after `jumpOpen` flips, so focus it here
  // rather than immediately after opening.
  $effect(() => {
    if ($jumpOpen) inputEl?.focus();
  });

  function jump(i: number) {
    const tile = rows[i];
    if (!tile) return;
    jumpOpen.set(false);
    focusedSessionId.set(tile.atlasSessionId);
    // `openSession` switches to an existing tab, or respawns one that has gone.
    if (tile.workspacePath && tile.atlasSessionId) {
      openSession(tile.workspacePath, tile.atlasSessionId);
    }
    showView("session");
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

  const STATE_LABEL: Record<string, string> = {
    needsYou: "needs you",
    running: "running",
    error: "error",
    idle: "idle",
  };
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
        placeholder="Jump to a running session…"
        autocomplete="off"
        spellcheck="false"
      />
      <span class="kbd">esc</span>
    </div>

    <div class="list">
      {#if rows.length === 0}
        <p class="empty">
          {tiles.length === 0
            ? "Nothing is running. ⌘N starts a session."
            : `No session matches “${query}”.`}
        </p>
      {:else}
        {#each rows as tile, i (tile.sessionUuid)}
          <button
            type="button"
            class="row"
            class:selected={i === selected}
            onclick={() => jump(i)}
          >
            <span class="swatch" style="background: {tile.workspaceColour}"></span>
            <span class="text">
              <span class="label">{tile.label}</span>
              <span class="meta">
                {tile.workspaceName || "—"}{tile.branch ? ` · ${tile.branch}` : ""}
              </span>
            </span>
            <span class="state" class:warn={tile.state === "needsYou"}>
              {STATE_LABEL[tile.state] ?? tile.state}
            </span>
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

  .swatch {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: var(--r-xs);
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
