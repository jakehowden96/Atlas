<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Toast from "./lib/components/Toast.svelte";
  import FilesView from "./lib/components/files/FilesView.svelte";
  import SessionsView from "./lib/components/sessions/SessionsView.svelte";
  import PrsView from "./lib/components/prs/PrsView.svelte";
  import SettingsModal from "./lib/components/settings/SettingsModal.svelte";
  import ShortcutSheet from "./lib/components/settings/ShortcutSheet.svelte";
  import JumpPalette from "./lib/components/session/JumpPalette.svelte";
  import NewSessionModal from "./lib/components/session/NewSessionModal.svelte";
  import StatsView from "./lib/components/stats/StatsView.svelte";
  import SessionView from "./lib/components/session/SessionView.svelte";
  import SegmentedControl, { type Segment } from "./lib/components/ui/SegmentedControl.svelte";
  import { bootApp } from "./lib/app-boot";
  import { log } from "./lib/logger";
  import { shouldClearNeedsInput } from "./lib/overview";
  import { isMacPlatform } from "./lib/platform";
  import { handleGlobalKeydown } from "./lib/shortcuts";
  import { todayCost } from "./lib/stats-derive";
  import { dirtyFiles } from "./lib/stores/files";
  import { liveTiles } from "./lib/stores/liveTiles";
  import { prsAttentionCount } from "./lib/stores/prs";
  import { chords, settingsOpen } from "./lib/stores/settings";
  import { statsSummary } from "./lib/stores/stats";
  import { activeTabId, setTabNeedsInput } from "./lib/stores/terminal";
  import { activeView, jumpOpen, openNewSession, showView, type View } from "./lib/stores/view";

  // `titleBarStyle: "Overlay"` only exists on macOS, where the window's title
  // bar is transparent and this strip stands in for it. Elsewhere the native
  // title bar is drawn, and a second one here would only cost 28px.
  const overlayTitleBar = isMacPlatform();

  // ── Top-bar status, off the same tiles the Sessions grid builds ───────────
  // Not off `$liveSessionList`: Claude Code's tail never reports `needsYou` —
  // the transcript cannot see a permission prompt, so `live.rs` `finalize`
  // only ever assigns Idle or Running, and a blocked session arrived here as
  // "running" while its tile correctly said needs-you. The Notification hook's
  // flag is its only needs-you signal and `buildTiles` is where it is folded
  // in, so counting anywhere else is counting the wrong thing.
  let needsYou = $derived($liveTiles.filter((t) => t.state === "needsYou").length);
  let running = $derived($liveTiles.filter((t) => t.state === "running").length);
  let idle = $derived($liveTiles.filter((t) => t.state === "idle").length);
  /* Today's spend comes off the persisted stats, not off `liveSessionList`:
     that list holds only the sessions Atlas is tailing, so a day's work done
     in Claude Code outside Atlas — or before this launch — read as $0. The
     backend recomputes within a second of a transcript write, so this stays
     current without a clock of its own beyond the midnight rollover. */
  let costClock = $state(Date.now());
  const costTicker = setInterval(() => {
    costClock = Date.now();
  }, 60_000);
  onDestroy(() => clearInterval(costTicker));
  let spendToday = $derived(todayCost($statsSummary, new Date(costClock)));

  // The Pull requests badge counts PRs asking for action; at zero it is left
  // off entirely rather than shown as a "0" alert pill. The Sessions count is
  // the tile count the chips and the status line use, which also covers a
  // session whose transcript is not being tailed.
  let viewOptions = $derived<Segment<View>[]>([
    { id: "sessions", label: "Sessions", count: $liveTiles.length },
    { id: "files", label: "Files", dot: $dirtyFiles.size > 0 },
    {
      id: "prs",
      label: "Pull requests",
      count: $prsAttentionCount > 0 ? $prsAttentionCount : undefined,
      alert: true,
    },
    { id: "stats", label: "Stats" },
  ]);

  // Clear needsInput once the user is actually looking at the session — see
  // `shouldClearNeedsInput`. Gating on `$activeTabId` alone cleared the flag
  // off sessions nobody had opened, because `activeTabId` moves on a spawn, on
  // a neighbouring tab closing and on SessionView reconciling itself while it
  // is hidden behind another view.
  $effect(() => {
    if (shouldClearNeedsInput($activeView, $activeTabId)) {
      setTabNeedsInput($activeTabId, false);
    }
  });

  // `bootApp` is async and the component can be torn down before it settles.
  let stopBoot: (() => void) | null = null;
  let destroyed = false;
  onMount(() => {
    bootApp()
      .then((stop) => {
        if (destroyed) stop();
        else stopBoot = stop;
      })
      .catch((e) => log.error("app", "boot failed", e));
  });

  onDestroy(() => {
    destroyed = true;
    stopBoot?.();
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if overlayTitleBar}
  <div class="titlebar" data-tauri-drag-region></div>
{/if}

<div class="app" class:overlay={overlayTitleBar}>
  <header class="topbar">
    <span class="wordmark">Atlas</span>
    <!-- Session is a detail view Sessions opens in place, not a tab of its own,
         so Sessions stays lit while it is showing. -->
    <SegmentedControl
      options={viewOptions}
      value={$activeView === "session" ? "sessions" : $activeView}
      onChange={(id) => showView(id)}
    />

    <div class="spacer"></div>

    <span class="status">
      <span class="status-dot"></span>
      {running} running · <span class="status-needs">{needsYou} needs you</span> · {idle} idle · ${spendToday.toFixed(
        2,
      )} today
    </span>

    <button type="button" class="jump" onclick={() => jumpOpen.set(true)}>
      Jump to…
      <span class="kbd">{$chords.jump}</span>
    </button>

    <button type="button" class="new-session" onclick={() => openNewSession()}>
      + Session <span class="kbd-inline">{$chords.newSession}</span>
    </button>

    <button
      type="button"
      class="gear"
      title={`Settings (${$chords.settings})`}
      onclick={() => settingsOpen.set(true)}
    >
      <span class="material-symbols-outlined">settings</span>
    </button>
  </header>

  <div class="view-host">
    <!-- Sessions stays mounted too: rebuilding the grid from scratch on every
         return was the visible delay coming back from a session. -->
    <div class="view" class:hidden={$activeView !== "sessions"}>
      <SessionsView />
    </div>
    {#if $activeView === "files"}
      <div class="view"><FilesView /></div>
    {:else if $activeView === "prs"}
      <div class="view"><PrsView /></div>
    {:else if $activeView === "stats"}
      <div class="view"><StatsView /></div>
    {/if}

    <!-- Session stays mounted: an xterm instance cannot survive a remount, so
         hiding it is the only way to keep PTYs alive across view switches. -->
    <div class="view" class:hidden={$activeView !== "session"}>
      <SessionView />
    </div>
  </div>
</div>

<NewSessionModal />
<JumpPalette />

<SettingsModal />
<ShortcutSheet />
<Toast />

<style>
  /* Keep terminal at its own font size — xterm manages this internally */
  :global(.xterm) {
    font-size: initial;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(.material-symbols-outlined) {
    font-variation-settings:
      "FILL" 0,
      "wght" 400,
      "GRAD" 0,
      "opsz" 24;
    font-size: 1.25rem;
    vertical-align: middle;
  }

  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 28px;
    z-index: 1000;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: drag;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--bg);
  }

  .app.overlay {
    height: calc(100vh - 28px);
    margin-top: 28px;
  }

  /* ── Top bar ───────────────────────────────────────────────────────────── */
  .topbar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    height: 46px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .wordmark {
    margin-right: 10px;
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  /* The counts are the top bar's primary readout, so they sit at --text
     rather than --muted. --warn (#e0a53a) is ~2.2:1 on white — fine as a
     fill, unreadable as text — so needs-you carries its own darkened token.
     On a dark surface --warn already clears 4.5:1 and the darkened amber
     would not, so the token flips back there. It lives here rather than in
     app.css because app.css belongs to another change this wave. */
  .status {
    --warn-ink: #8f6200;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  :global(:root[data-theme="dark"]) .status {
    --warn-ink: var(--warn);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .status {
      --warn-ink: var(--warn);
    }
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: atlasPulse 1.6s ease-in-out infinite;
  }

  .status-needs {
    color: var(--warn-ink);
  }

  .jump {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 220px;
    min-width: 140px;
    height: 28px;
    padding: 0 10px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface2);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .jump:hover {
    border-color: var(--border2);
  }

  .kbd {
    margin-left: auto;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-xs);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .new-session {
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: var(--r-lg);
    background: var(--ink);
    color: var(--ink-text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .kbd-inline {
    margin-left: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    opacity: 0.6;
  }

  .gear {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }

  .gear:hover {
    border-color: var(--border2);
    color: var(--text);
  }

  .gear :global(.material-symbols-outlined) {
    font-size: var(--fs-lg);
  }

  /* ── View host ─────────────────────────────────────────────────────────── */
  .view-host {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    animation: atlasFadeIn 0.18s ease;
  }

  /* display:none also restarts atlasFadeIn when the pane comes back. */
  .view.hidden {
    display: none;
  }
</style>
