<script lang="ts">
  import { chords } from "../../stores/settings";
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import type { SessionState } from "../../../types/session";
  import { formatTokens } from "../../format";
  import { buildTiles, compareByAttention, formatElapsed, type SessionTile } from "../../overview";
  import { allowPendingTool, closeSession, denyPendingTool } from "../../session-actions";
  import { refreshPanel } from "../../ipc";
  import { filesTouched, tabIdForSession } from "../../session-view";
  import { liveSessionList } from "../../stores/liveSessions";
  import { panelData } from "../../stores/panel";
  import { activeTabId, tabs } from "../../stores/terminal";
  import { activeView, diffOpen, focusedSessionId, railOpen, showView } from "../../stores/view";
  import { sessionDiffStats, visibleWorkspaces, workspaces } from "../../stores/workspace";
  import ChangesDrawer from "../changes/ChangesDrawer.svelte";
  import TerminalContainer from "../terminal/TerminalContainer.svelte";
  import StatePill, { type PillState } from "../ui/StatePill.svelte";
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

  let needsInputTabs = $derived(new Set($tabs.filter((t) => t.needsInput).map((t) => t.id)));
  let tiles = $derived(
    [...buildTiles($liveSessionList, $visibleWorkspaces, $sessionDiffStats, needsInputTabs)].sort(
      compareByAttention,
    ),
  );

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
  let subtitle = $derived(tile ? [tile.branch, elapsed].filter(Boolean).join(" · ") : "");
  let files = $derived(filesTouched($panelData));

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
      <button type="button" class="back" onclick={() => showView("sessions")}>
        ← Sessions <span class="hint">esc</span>
      </button>

      {#if tile}
        <StatePill state={PILL[tile.state]} />
        <span class="label">{tile.label}</span>
        <span class="ws" title={tile.workspacePath}>
          <span class="ws-dot" style="background: {tile.workspaceColour}"></span>
          {tile.workspaceName}
        </span>
        <span class="subtitle">{subtitle}</span>
      {:else}
        <span class="label empty-label">No session selected</span>
      {/if}

      <div class="spacer"></div>

      {#each tiles as t (t.sessionUuid)}
        <button
          type="button"
          class="switch-dot {PILL[t.state]}"
          class:active={t.terminalTabId === visibleTabId}
          title={t.label}
          aria-label="Switch to {t.label}"
          onclick={() => focus(t)}
        ></button>
      {/each}

      <button
        type="button"
        class="changes"
        class:on={$diffOpen}
        onclick={() => diffOpen.update((v) => !v)}
      >
        Changes
        <span class="added">+{tile?.diff?.linesAdded ?? 0}</span>
        <span class="removed">−{tile?.diff?.linesRemoved ?? 0}</span>
      </button>

      <button
        type="button"
        class="rail-toggle"
        class:on={$railOpen}
        title={`Toggle activity rail (${$chords.toggleRail})`}
        aria-label="Toggle activity rail"
        onclick={() => railOpen.update((v) => !v)}
      >▥</button>

      <button
        type="button"
        class="close-session"
        title="Close session"
        aria-label="Close session"
        onclick={endSession}
      >✕</button>
    </header>

    <div class="pane">
      <TerminalContainer {visibleTabId} />

      {#if tile && tile.state === "needsYou"}
        <div class="permission">
          <span class="warn-dot"></span>
          <div class="permission-text">
            <div class="wants">
              Claude wants to run
              <span class="tool">{tile.live.pendingTool?.name ?? tile.live.lastTool ?? "a tool"}</span>
            </div>
            <div class="caption">Permission prompt · your answer is typed into the TUI for you</div>
          </div>
          <button
            type="button"
            class="deny"
            onclick={() => tile?.terminalTabId && denyPendingTool(tile.terminalTabId)}
          >Deny</button>
          <button
            type="button"
            class="allow"
            onclick={() => tile?.terminalTabId && allowPendingTool(tile.terminalTabId)}
          >Allow</button>
        </div>
      {/if}
    </div>

    <footer class="foot">
      <span class="last-tool">{tile?.live.lastTool ?? "—"}</span>
      <div class="spacer"></div>
      <span>{tile?.live.toolCalls ?? 0} tools</span>
      <span>{formatTokens(tile?.live.peakContext ?? 0)} ctx</span>
      <span>${(tile?.live.costEstimate ?? 0).toFixed(2)}</span>
    </footer>
  </div>

  <ActivityRail open={$railOpen} {tile} {now} {files} />

  <!-- Slides over the whole view, so it is a sibling of `.main` and the rail.
       The header button above and the rail's "Review →" link both toggle
       `diffOpen`; Esc closes it first (see `shortcuts.ts`). -->
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
    gap: 10px;
    height: 44px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }

  .back {
    flex-shrink: 0;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .back:hover {
    background: var(--surface2);
  }

  .hint {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-label {
    color: var(--muted);
    font-weight: 400;
  }

  /* Which project this terminal belongs to. Same colour-plus-name pairing as
     the Sessions grid, so the two screens read alike; the name carries it on
     its own and the colour only reinforces. */
  .ws {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    max-width: 180px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .subtitle {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .switch-dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    margin-left: 6px;
    padding: 0;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .switch-dot.running {
    background: var(--accent);
  }

  .switch-dot.needs {
    background: var(--warn);
  }

  .switch-dot.idle {
    background: var(--muted);
  }

  .switch-dot.error {
    background: var(--danger);
  }

  .switch-dot.active {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--text);
  }

  .changes {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    height: 26px;
    margin-left: 10px;
    padding: 0 10px;
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .changes.on {
    border-color: var(--text);
  }

  .changes:hover {
    background: var(--surface2);
  }

  .added {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .removed {
    color: var(--danger);
    font-family: var(--font-mono);
  }

  .rail-toggle {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12px;
    cursor: pointer;
  }

  .close-session {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }

  .close-session:hover {
    background: var(--surface3);
    color: var(--danger);
  }

  .rail-toggle:hover,
  .rail-toggle.on {
    color: var(--text);
  }

  /* ── Terminal pane ─────────────────────────────────────────────────────── */
  .pane {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--term-bg);
  }

  /* ── Floating permission card ──────────────────────────────────────────── */
  .permission {
    position: absolute;
    right: 18px;
    bottom: 16px;
    left: 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--warn) 50%, transparent);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .warn-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warn);
  }

  .permission-text {
    flex: 1;
    min-width: 0;
  }

  .wants {
    font-size: 12.5px;
    font-weight: 500;
  }

  .tool {
    color: var(--t-warn);
    font-family: var(--font-mono);
  }

  .caption {
    color: var(--muted);
    font-size: 11px;
  }

  .deny,
  .allow {
    flex-shrink: 0;
    height: 26px;
    border-radius: var(--r-md);
    font-family: var(--font-ui);
    cursor: pointer;
  }

  .deny {
    padding: 0 10px;
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
  }

  .allow {
    padding: 0 12px;
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 12px;
    font-weight: 600;
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
    font-size: 11px;
  }

  .last-tool {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
