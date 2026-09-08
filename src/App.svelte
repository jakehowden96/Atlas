<script lang="ts">
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import Toast from "./lib/components/Toast.svelte";
  import PrsView from "./lib/components/prs/PrsView.svelte";
  import SettingsModal from "./lib/components/panel/SettingsModal.svelte";
  import StatsView from "./lib/components/panel/StatsView.svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import Modal from "./lib/components/ui/Modal.svelte";
  import SegmentedControl, { type Segment } from "./lib/components/ui/SegmentedControl.svelte";
  import { onClaudeNotification, onPanelUpdate, onSessionUpdate } from "./lib/ipc";
  import { log } from "./lib/logger";
  import { addWorkspaceFolder, spawnClaudeSession } from "./lib/session-actions";
  import { handleGlobalKeydown } from "./lib/shortcuts";
  import { liveSessionList, upsertLiveSession } from "./lib/stores/liveSessions";
  import { panelData } from "./lib/stores/panel";
  import { prsAttentionCount, startPrPolling } from "./lib/stores/prs";
  import { enableNotifications, loadSettings, settingsOpen } from "./lib/stores/settings";
  import { activeTabId, setTabNeedsInput } from "./lib/stores/terminal";
  import { activeView, jumpOpen, newSessionOpen, showView, type View } from "./lib/stores/view";
  import {
    activeWorkspacePath,
    loadWorkspaces,
    setSessionDiffStats,
    workspaces,
  } from "./lib/stores/workspace";

  let unlisten: UnlistenFn | null = null;
  let unlistenNotification: UnlistenFn | null = null;
  let unlistenSession: UnlistenFn | null = null;
  let stopPrPolling: (() => void) | null = null;

  // ── Top-bar status, straight off the live transcript tails ────────────────
  let running = $derived($liveSessionList.filter((s) => s.state === "running").length);
  let needsYou = $derived($liveSessionList.filter((s) => s.state === "needsYou").length);
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
    { id: "overview", label: "Overview", count: $liveSessionList.length },
    { id: "session", label: "Session" },
    {
      id: "prs",
      label: "Pull requests",
      count: $prsAttentionCount > 0 ? $prsAttentionCount : undefined,
      alert: true,
    },
    { id: "stats", label: "Stats" },
  ]);

  // Clear needsInput when switching to a tab
  $effect(() => {
    if ($activeTabId) {
      setTabNeedsInput($activeTabId, false);
    }
  });

  async function startSession(workspacePath: string) {
    newSessionOpen.set(false);
    await spawnClaudeSession(workspacePath);
    showView("session");
  }

  async function addWorkspace() {
    const path = await addWorkspaceFolder();
    if (path) activeWorkspacePath.set(path);
  }

  onMount(async () => {
    await log.init();
    log.info("app", "onMount started");
    await loadWorkspaces();
    const ws = get(workspaces);
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
    <SegmentedControl
      options={viewOptions}
      value={$activeView}
      onChange={(id) => showView(id as View)}
    />

    <div class="spacer"></div>

    <span class="status">
      <span class="status-dot"></span>
      {running} running · <span class="status-needs">{needsYou} needs you</span> · ${todayCost.toFixed(2)} today
    </span>

    <button type="button" class="jump" onclick={() => jumpOpen.set(true)}>
      Jump to session…
      <span class="kbd">⌘K</span>
    </button>

    <button type="button" class="new-session" onclick={() => newSessionOpen.set(true)}>
      + Session <span class="kbd-inline">⌘N</span>
    </button>

    <button type="button" class="gear" title="Settings (⌘,)" onclick={() => settingsOpen.set(true)}>
      <span class="material-symbols-outlined">settings</span>
    </button>
  </header>

  <div class="view-host">
    {#if $activeView === "overview"}
      <div class="view placeholder">
        <span class="material-symbols-outlined placeholder-icon">grid_view</span>
        <p class="placeholder-text">
          {$liveSessionList.length === 0
            ? "Nothing running — start a session with ⌘N"
            : `${$liveSessionList.length} live session${$liveSessionList.length === 1 ? "" : "s"}`}
        </p>
      </div>
    {:else if $activeView === "prs"}
      <div class="view"><PrsView /></div>
    {:else if $activeView === "stats"}
      <div class="view"><StatsView /></div>
    {/if}

    <!-- Session stays mounted: an xterm instance cannot survive a remount, so
         hiding it is the only way to keep PTYs alive across view switches. -->
    <div class="view" class:hidden={$activeView !== "session"}>
      <TerminalContainer />
    </div>
  </div>
</div>

<Modal
  open={$newSessionOpen}
  onClose={() => newSessionOpen.set(false)}
  align="top"
  width="520px"
>
  <div class="sheet">
    <div class="sheet-head">
      <span class="sheet-title">New session</span>
      <span class="kbd">esc</span>
    </div>
    <div class="sheet-body">
      {#each $workspaces as ws (ws.path)}
        <button type="button" class="ws-row" onclick={() => startSession(ws.path)}>
          <span class="ws-dot" style="background: {ws.color ?? 'var(--accent)'}"></span>
          <span class="ws-name">{ws.name}</span>
          <span class="ws-path">{ws.path}</span>
        </button>
      {/each}
      <button type="button" class="ws-row add" onclick={addWorkspace}>Add folder…</button>
    </div>
  </div>
</Modal>

<Modal open={$jumpOpen} onClose={() => jumpOpen.set(false)} align="top" width="520px">
  <div class="sheet">
    <div class="sheet-head">
      <span class="sheet-title">Jump to session</span>
      <span class="kbd">esc</span>
    </div>
    <div class="sheet-body">
      <p class="placeholder-text">The command palette lands with the New Session flow.</p>
    </div>
  </div>
</Modal>

<SettingsModal />
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

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: atlasPulse 1.6s ease-in-out infinite;
  }

  .status-needs {
    color: var(--warn);
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

  .placeholder {
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    opacity: 0.5;
  }

  .placeholder-icon {
    font-size: 2.5rem !important;
    color: var(--muted);
  }

  .placeholder-text {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }

  /* ── Placeholder modal sheets (phase 10 replaces both) ─────────────────── */
  .sheet {
    display: flex;
    flex-direction: column;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
  }

  .sheet-title {
    font-size: 13px;
    font-weight: 600;
  }

  .sheet-head .kbd {
    margin-left: auto;
    color: var(--muted);
  }

  .sheet-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    padding: 10px;
    overflow-y: auto;
  }

  .ws-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    border-radius: var(--r-lg);
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .ws-row:hover {
    background: var(--surface2);
  }

  .ws-row.add {
    color: var(--muted);
  }

  .ws-dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: var(--r-xs);
  }

  .ws-name {
    font-weight: 500;
  }

  .ws-path {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
