<script lang="ts">
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
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
  import { onClaudeNotification, onPanelUpdate, onSessionUpdate } from "./lib/ipc";
  import { log } from "./lib/logger";
  import { buildTiles, shouldClearNeedsInput } from "./lib/overview";
  import { filesTouched } from "./lib/session-view";
  import { handleGlobalKeydown } from "./lib/shortcuts";
  import { dirtyFiles } from "./lib/stores/files";
  import { liveSessionList, upsertLiveSession } from "./lib/stores/liveSessions";
  import { panelData, setSessionTouchedFiles } from "./lib/stores/panel";
  import { prsAttentionCount, startPrPolling } from "./lib/stores/prs";
  import { chords, enableNotifications, loadSettings, settingsOpen } from "./lib/stores/settings";
  import { activeTabId, setTabNeedsInput, tabs } from "./lib/stores/terminal";
  import { activeView, jumpOpen, openNewSession, showView, type View } from "./lib/stores/view";
  import {
    activeWorkspacePath,
    loadWorkspaces,
    sessionDiffStats,
    setSessionDiffStats,
    visibleWorkspaces,
  } from "./lib/stores/workspace";

  let unlisten: UnlistenFn | null = null;
  let unlistenNotification: UnlistenFn | null = null;
  let unlistenSession: UnlistenFn | null = null;
  let stopPrPolling: (() => void) | null = null;

  // ── Top-bar status, off the same tiles the Sessions grid builds ───────────
  // Not off `$liveSessionList`: the backend never reports `needsYou` — the
  // transcript cannot see a permission prompt, so `live.rs` `finalize` only
  // ever assigns Idle or Running, and a blocked session arrived here as
  // "running" while its tile correctly said needs-you. The Notification hook's
  // flag is the only needs-you signal and `buildTiles` is where it is folded
  // in, so counting anywhere else is counting the wrong thing.
  let needsInputTabs = $derived(
    new Set($tabs.filter((t) => t.needsInput).map((t) => t.id)),
  );
  let statusTiles = $derived(
    buildTiles($liveSessionList, $visibleWorkspaces, $sessionDiffStats, needsInputTabs),
  );
  let needsYou = $derived(statusTiles.filter((t) => t.state === "needsYou").length);
  let running = $derived(statusTiles.filter((t) => t.state === "running").length);
  let idle = $derived(statusTiles.filter((t) => t.state === "idle").length);
  let todayCost = $derived(
    $liveSessionList
      .filter((s) => isToday(s.lastActivity ?? s.startedAt))
      .reduce((sum, s) => sum + s.costEstimate, 0),
  );

  function isToday(iso: string | null): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  // The Pull requests badge counts PRs asking for action; at zero it is left
  // off entirely rather than shown as a "0" alert pill.
  let viewOptions = $derived<Segment[]>([
    { id: "sessions", label: "Sessions", count: $liveSessionList.length },
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

  onMount(async () => {
    await log.init();
    log.info("app", "onMount started");
    await loadWorkspaces();
    const ws = get(visibleWorkspaces);
    log.info("app", `workspaces loaded: ${ws.length}`);
    if (ws.length > 0 && !get(activeWorkspacePath)) {
      activeWorkspacePath.set(ws[0].path);
      log.info("app", `active workspace set: ${ws[0].path}`);
    }
    await loadSettings();
    // Poll from the shell, not from PrsView: the top-bar badge has to stay
    // current while the Pull requests screen is unmounted.
    stopPrPolling = startPrPolling();
    unlisten = await onPanelUpdate((sessionId, data) => {
      if (sessionId === get(activeTabId)) {
        panelData.set(data);
      }
      // The Files rail asks which sessions have touched the document it is
      // showing, so the per-file counts are kept for every session too.
      setSessionTouchedFiles(sessionId, filesTouched(data));
      // Update diff badge for any session, not just the active one
      if (data.diff && (data.diff.files_changed > 0 || data.diff.lines_added > 0 || data.diff.lines_removed > 0)) {
        setSessionDiffStats(sessionId, {
          filesChanged: data.diff.files_changed,
          linesAdded: data.diff.lines_added,
          linesRemoved: data.diff.lines_removed,
        });
      } else {
        setSessionDiffStats(sessionId, null);
      }
    });
    unlistenSession = await onSessionUpdate((_sessionUuid, session) => {
      upsertLiveSession(session);
    });
    unlistenNotification = await onClaudeNotification(async (event) => {
      const { session_id, notification } = event;
      // Only mark as needing input for notification types that require user action.
      // Excludes idle_prompt — that fires when Claude finishes work and returns to
      // its prompt, which doesn't require user input.
      const inputTypes = ["permission_prompt", "elicitation_dialog"];
      if (!inputTypes.includes(notification.notification_type)) return;

      setTabNeedsInput(session_id, true);

      // Send OS notification if enabled and tab is not active
      if (get(activeTabId) !== session_id && get(enableNotifications)) {
        try {
          let granted = await isPermissionGranted();
          if (!granted) {
            const permission = await requestPermission();
            granted = permission === "granted";
          }
          if (granted) {
            sendNotification({
              title: notification.title || "Claude needs input",
              body: notification.message || "A Claude session is waiting for your response",
            });
          }
        } catch (e) {
          log.warn("app", `notification failed: ${e}`);
          console.warn("Failed to send notification:", e);
        }
      }
    });
  });

  onDestroy(() => {
    unlisten?.();
    unlistenNotification?.();
    unlistenSession?.();
    stopPrPolling?.();
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="titlebar" data-tauri-drag-region></div>

<div class="app">
  <header class="topbar">
    <div class="dots"><span></span><span></span><span></span></div>
    <span class="wordmark">Atlas</span>
    <!-- Session is a detail view Sessions opens in place, not a tab of its own,
         so Sessions stays lit while it is showing. -->
    <SegmentedControl
      options={viewOptions}
      value={$activeView === "session" ? "sessions" : $activeView}
      onChange={(id) => showView(id as View)}
    />

    <div class="spacer"></div>

    <span class="status">
      <span class="status-dot"></span>
      {running} running · <span class="status-needs">{needsYou} needs you</span> · {idle} idle · ${todayCost.toFixed(2)} today
    </span>

    <button type="button" class="jump" onclick={() => jumpOpen.set(true)}>
      Jump to…
      <span class="kbd">{$chords.jump}</span>
    </button>

    <button type="button" class="new-session" onclick={() => openNewSession()}>
      + Session <span class="kbd-inline">{$chords.newSession}</span>
    </button>

    <button type="button" class="gear" title={`Settings (${$chords.settings})`} onclick={() => settingsOpen.set(true)}>
      <span class="material-symbols-outlined">settings</span>
    </button>
  </header>

  <div class="view-host">
    {#if $activeView === "sessions"}
      <div class="view"><SessionsView /></div>
    {:else if $activeView === "files"}
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
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
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
    app-region: drag;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 28px);
    width: 100vw;
    margin-top: 28px;
    background: var(--bg);
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

  .dots {
    display: flex;
    gap: 7px;
    margin-right: 6px;
  }

  .dots span {
    display: block;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--surface3);
  }

  .wordmark {
    margin-right: 10px;
    font-size: 13px;
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
    font-size: 12px;
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
    font-size: 12px;
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
    font-size: 10px;
  }

  .new-session {
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: var(--r-lg);
    background: var(--ink);
    color: var(--ink-text);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .kbd-inline {
    margin-left: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
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
    font-size: 16px;
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
