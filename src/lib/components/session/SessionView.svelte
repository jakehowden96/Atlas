<script lang="ts">
  import { chords } from "../../stores/settings";
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import type { SessionState } from "../../../types/generated/SessionState";
    import { compareByAttention, formatElapsed, type SessionTile } from "../../overview";
  import { closeSession } from "../../session-actions";
  import { refreshPanel } from "../../ipc";
  import type { MenuItem } from "../ui/Menu.svelte";
  import { tabIdForSession } from "../../session-view";
  import { liveTiles } from "../../stores/liveTiles";
  import { panelData } from "../../stores/panel";
  import { activeTabId, tabs } from "../../stores/terminal";
  import {
    activeView,
    cycleRail,
    diffOpen,
    focusedSessionId,
    railOpen,
    railWidth,
    showView,
  } from "../../stores/view";
  import { workspaces } from "../../stores/workspace";
  import ChangesDrawer from "../changes/ChangesDrawer.svelte";
  import TerminalContainer from "../terminal/TerminalContainer.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import MenuButton from "../ui/MenuButton.svelte";
  import StatePill, { type PillState } from "../ui/StatePill.svelte";
  import Icon from "../ui/Icon.svelte";
  import Tooltip from "../ui/Tooltip.svelte";
  import { tooltip } from "../../ui/tooltip";
  import ActivityRail from "./ActivityRail.svelte";

  const PILL: Record<SessionState, PillState> = {
    running: "running",
    needsYou: "needs",
    idle: "idle",
    error: "error",
  };

  // This component stays mounted for the life of the app so the xterm instances
  // it hosts survive view switches, so the clock only ticks while it is on screen.
  let now = $state(Date.now());
  const clock = setInterval(() => {
    if (get(activeView) === "session") now = Date.now();
  }, 1000);
  onDestroy(() => clearInterval(clock));

  let tiles = $derived([...$liveTiles].sort(compareByAttention));

  /**
   * The visible terminal. Resolved from `focusedSessionId` through the
   * workspace rows rather than from the tiles, because a freshly spawned
   * session has a PTY long before its first transcript line exists — keying
   * off live data would leave the pane blank until the tail caught up.
   */
  let visibleTabId = $derived(tabIdForSession($workspaces, $focusedSessionId) || $activeTabId);
  let tile = $derived(tiles.find((t) => t.terminalTabId === visibleTabId) ?? null);

  // Panel refresh, `onPanelUpdate` and the needs-input clear are all gated on
  // `activeTabId`, so it has to follow the focused session.
  $effect(() => {
    if (visibleTabId && get(activeTabId) !== visibleTabId) activeTabId.set(visibleTabId);
  });

  /* Prime the diff for the focused session. `sessionDiffStats` only fills from
     `panel-update`, and nothing asks for one until the drawer opens — so the
     header read "+0 −0" for a session with real changes until you clicked
     Changes. Refresh once per session so the count is right on arrival. */
  let primedFor = "";
  $effect(() => {
    const id = visibleTabId;
    if (!id || id === primedFor) return;
    primedFor = id;
    const dir = get(tabs).find((t) => t.id === id)?.cwd ?? "";
    if (!dir) return;
    void refreshPanel(id, dir)
      .then((fresh) => {
        if (fresh && get(activeTabId) === id) panelData.set(fresh);
      })
      .catch(() => {
        // `refreshPanel` logs its own failures; a background prime stays quiet.
      });
  });

  /* Ends the session and keeps its row resumable; `closeSession` sends us back
     to Sessions because the focused session is the one going away. */
  function endSession() {
    if (tile?.atlasSessionId) void closeSession(tile.atlasSessionId);
  }

  let elapsed = $derived(tile ? formatElapsed(tile.live.startedAt, now) : "");
  /* The workspace has its own chip in the header now, so the subtitle keeps
     only what changes underneath it. */
  let changed = $derived((tile?.diff?.linesAdded ?? 0) + (tile?.diff?.linesRemoved ?? 0) > 0);

  const STATE_WORD: Record<SessionState, string> = {
    running: "running",
    needsYou: "needs input",
    idle: "idle",
    error: "error",
  };
  let others = $derived(tiles.filter((t) => t.terminalTabId !== visibleTabId));
  let othersLabel = $derived.by(() => {
    if (!others.length) return "Other sessions";
    const n = new Map<SessionState, number>();
    for (const t of others) n.set(t.state, (n.get(t.state) ?? 0) + 1);
    return `Other sessions · ${[...n].map(([k, v]) => `${v} ${STATE_WORD[k]}`).join(", ")}`;
  });
  let otherItems = $derived<MenuItem[]>(
    others.map((t) => ({ id: t.sessionUuid, label: `${t.label} · ${STATE_WORD[t.state]}` })),
  );
  function pickOther(item: MenuItem) {
    const t = others.find((o) => o.sessionUuid === item.id);
    if (t) focus(t);
  }

  function focus(target: SessionTile) {
    focusedSessionId.set(target.atlasSessionId);
    // A session with no workspace row has no Atlas id to focus by, so seed the
    // tab-id fallback `visibleTabId` reads when the id resolves to nothing.
    if (target.terminalTabId) activeTabId.set(target.terminalTabId);
  }
</script>

<div class="session">
  <div class="main">
    <header class="head">
      <Tooltip text="Back to Sessions" shortcut={$chords.backToSessions}>
        <IconButton icon="arrow_back" label="Back to Sessions" onclick={() => showView("sessions")} />
      </Tooltip>

      {#if tile}
        <StatePill state={PILL[tile.state]} />
        <span class="label">{tile.label}</span>
        <span class="ws" use:tooltip={{ text: tile.workspacePath }}>
          <span class="swatch" style="--tc: {tile.workspaceColour}"></span>
          <span class="ws-name">{tile.workspaceName}</span>
        </span>
        <span class="subtitle">
          {#if tile.branch}<span class="branch">{tile.branch} · </span>{/if}{elapsed}
        </span>
      {:else}
        <span class="label empty-label">No session selected</span>
      {/if}

      <div class="spacer"></div>

      {#if others.length}
        <MenuButton label={othersLabel} items={otherItems} onselect={pickOther} align="end" />
      {/if}

      <Button aria-pressed={$diffOpen} onclick={() => diffOpen.update((v) => !v)}>
        {#snippet leading()}<Icon name="difference" />{/snippet}
        <span class="changes-word">Changes</span>
        {#if changed}
          <span class="added">+{tile?.diff?.linesAdded ?? 0}</span>
          <span class="removed">−{tile?.diff?.linesRemoved ?? 0}</span>
        {/if}
      </Button>

      <Tooltip text="Toggle activity rail" shortcut={$chords.toggleRail}>
        <IconButton
          icon={$railOpen ? "right_panel_close" : "right_panel_open"}
          label="Toggle activity rail"
          aria-pressed={$railOpen}
          onclick={() => {
            const next = cycleRail($railOpen, $railWidth);
            railWidth.set(next.width);
            railOpen.set(next.open);
          }}
        />
      </Tooltip>

      <Tooltip text="Close session" shortcut={$chords.closeSession}>
        <IconButton icon="close" label="Close session" onclick={endSession} />
      </Tooltip>
    </header>

    <!-- No permission card over the terminal: Claude Code draws its own prompt
         at the bottom of the TUI, which is exactly where a floating card sits.
         Answering here means reading the real prompt. The Sessions grid keeps
         its permission bar — there the TUI is not on screen to read. -->
    <div class="pane">
      <TerminalContainer {visibleTabId} />
    </div>

    <footer class="foot">
      <span class="last-tool">{tile?.live.lastTool ?? "No tool calls yet"}</span>
      <div class="spacer"></div>
      <span>{tile ? "Transcript live" : "No transcript"}</span>
    </footer>
  </div>

  <ActivityRail open={$railOpen} {tile} {now} />

  <!-- Slides over the whole view, so it is a sibling of `.main` and the rail.
       The header button above toggles `diffOpen`; Esc closes it first
       (see `shortcuts.ts`). -->
  <ChangesDrawer open={$diffOpen} />
</div>

<style>
  .session {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    background: var(--surface);
  }

  /* ── Header ────────────────────────────────────────────────────────────── */
  .head {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-3);
    height: var(--h-bar);
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }

  .label {
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-label {
    color: var(--muted);
    font-weight: var(--fw-body);
  }

  .ws {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-2);
    max-width: 180px;
    color: var(--text);
    font-size: var(--fs-sm);
  }

  .swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: var(--r-sm);
    background: var(--tc);
  }

  .ws-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .added {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .removed {
    color: var(--danger);
    font-family: var(--font-mono);
  }

  /* Small windows: drop the branch and the word, keep the icon. */
  @media (max-width: 900px) {
    .branch,
    .changes-word {
      display: none;
    }
  }

  /* ── Terminal pane ─────────────────────────────────────────────────────── */
  .pane {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--term-bg);
  }

  /* ── Footer status bar ─────────────────────────────────────────────────── */
  .foot {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 14px;
    height: 30px;
    padding: 0 16px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .last-tool {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
