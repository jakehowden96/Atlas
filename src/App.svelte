<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import SidePanel from "./lib/components/panel/SidePanel.svelte";
  import Resizer from "./lib/components/layout/Resizer.svelte";
  import AgentManager from "./lib/components/layout/AgentManager.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import SettingsModal from "./lib/components/panel/SettingsModal.svelte";
  import { Terminal } from "@xterm/xterm";
  import { panelVisible, panelData } from "./lib/stores/panel";
  import { tabs, activeTabId, activeTab, addTab, removeTab, setTabNeedsInput, setTabReady } from "./lib/stores/terminal";
  import { onPanelUpdate, onClaudeNotification, ptyWrite, ptyKill, ptyResize } from "./lib/ipc";
  import { skipPermissions, enableNotifications, loadSettings } from "./lib/stores/settings";
  import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
  import {
    workspaces,
    activeWorkspacePath,
    activeSessionId,
    loadWorkspaces,
    addWorkspace as storeAddWorkspace,
    addSession,
    setClaudeSessionId,
    removeSession,
    removeWorkspace,
    resumeSession,
    updateSessionStatus,
    setWorkspaceColor,
    stripBundleExtension,
    setSessionDiffStats,
  } from "./lib/stores/workspace";
  import { open } from "@tauri-apps/plugin-dialog";
  import { get } from "svelte/store";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { log } from "./lib/logger";

  let panelFraction = $state(0.5);
  let sidebarWidth = $state(160);
  let isResizing = $state(false);
  let mainStageWidth = $state(0);
  let panelWidth = $derived(Math.round(mainStageWidth * panelFraction));
  let unlisten: UnlistenFn | null = null;
  let unlistenNotification: UnlistenFn | null = null;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const spawningSessionIds = new Set<string>();

  let openTabIds = $derived(new Set($tabs.map(t => t.id)));

  // Panel auto-hides when there are no tabs. When the first tab appears
  // we auto-open it. Beyond that the user owns visibility via togglePanel —
  // we don't reopen on every panelData update (that broke the close button).
  // Tabs with suppressPanel (e.g. the PRs screen) force the panel closed
  // while active; leaving them restores the panel so the diff comes back.
  let hadActiveTab = $state(false);
  let prevSuppress = $state(false);
  $effect(() => {
    const hasActiveTab = !!$activeTabId;
    const suppress = $activeTab?.type === "terminal" && $activeTab.suppressPanel === true;
    if (!hasActiveTab) {
      panelVisible.set(false);
      hadActiveTab = false;
    } else if (suppress) {
      panelVisible.set(false);
    } else if (!hadActiveTab || prevSuppress) {
      panelVisible.set(true);
      hadActiveTab = true;
    }
    prevSuppress = suppress;
  });

  // Clear needsInput when switching to a tab
  $effect(() => {
    if ($activeTabId) {
      setTabNeedsInput($activeTabId, false);
    }
  });

  const MIN_PANEL_FRACTION = 0.2;
  const MAX_PANEL_FRACTION = 0.8;
  const MIN_SIDEBAR_WIDTH = 120;
  const MAX_SIDEBAR_WIDTH = 280;

  function handleResize(delta: number) {
    if (mainStageWidth <= 0) return;
    const deltaFraction = delta / mainStageWidth;
    panelFraction = Math.min(
      MAX_PANEL_FRACTION,
      Math.max(MIN_PANEL_FRACTION, panelFraction + deltaFraction),
    );
  }

  function handleSidebarResize(delta: number) {
    sidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth - delta));
  }

  function handleResizeStart() { isResizing = true; }
  function handleResizeEnd() { isResizing = false; }

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
    // Pre-spawn the PRs tab AND start `prs` immediately so the live
    // dashboard is already populated by the time the user opens it.
    runPrsOnce(spawnPrsTab(false));
    unlisten = await onPanelUpdate((sessionId, data) => {
      if (sessionId === get(activeTabId)) {
        const active = get(tabs).find((t) => t.id === sessionId);
        const suppress = active?.type === "terminal" && active.suppressPanel === true;
        if (!suppress) panelData.set(data);
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
  });

  /**
   * Spawn the PRs terminal tab (singleton). With `activate=false` the shell
   * boots in the background; `prs` is a live-updating dashboard that polls
   * GitHub every 3 minutes, so we kick it off immediately and just hide
   * the tab until the user toggles it open.
   */
  let prsCommandWritten = false;
  let prevTabBeforePrs = "";
  function spawnPrsTab(activate: boolean): string {
    const id = crypto.randomUUID();
    const terminal = new Terminal();
    addTab({
      type: "terminal",
      id,
      title: "PRs",
      ptyId: -1,
      terminal,
      role: "prs",
      suppressPanel: true,
    }, { activate });
    return id;
  }

  function runPrsOnce(tabId: string) {
    if (prsCommandWritten || !tabId) return;
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      const t = get(tabs).find((x) => x.id === tabId);
      if (!t || attempts > 100) {
        clearInterval(poll);
        return;
      }
      if (t.type === "terminal" && t.ptyId >= 0) {
        clearInterval(poll);
        // The hidden terminal is 0×0, so force a sensible PTY size before
        // running prs — otherwise the output has no buffer to render into.
        // The ResizeObserver in TerminalSession refits to the real container
        // size as soon as the tab becomes visible.
        ptyResize(t.ptyId, 200, 60);
        ptyWrite(t.ptyId, "prs\n");
        prsCommandWritten = true;
      }
    }, 100);
  }

  /**
   * Spawn a terminal tab in the given workspace directory, run `claude`
   * (or `claude --resume <id>` for existing sessions).
   * New sessions get a pre-generated UUID passed via `--session-id`.
   */
  async function spawnClaudeSession(workspacePath: string, resumeId?: string, existingSessionId?: string) {
    const tabId = crypto.randomUUID();
    const terminal = new Terminal();
    let session: { id: string };
    let claudeSessionId: string | undefined;

    if (existingSessionId) {
      await resumeSession(existingSessionId, tabId);
      session = { id: existingSessionId };
    } else {
      // Generate a Claude session ID upfront so we can pass it via --session-id
      // and store it immediately — no need to capture it from terminal output.
      claudeSessionId = crypto.randomUUID();
      const wsName = get(workspaces).find((w) => w.path === workspacePath)?.name
        ?? stripBundleExtension(workspacePath.split("/").filter(Boolean).pop() ?? "New session");
      session = await addSession(workspacePath, wsName, tabId);
      await setClaudeSessionId(session.id, claudeSessionId);
    }

    addTab({ type: "terminal", id: tabId, title: "", ptyId: -1, terminal, cwd: workspacePath, ready: false });

    // Once the PTY is ready, send the claude command.
    // We watch for the ptyId to become available via a short poll since
    // handlePtyReady fires inside TerminalContainer.
    let pollAttempts = 0;
    const poll = setInterval(async () => {
      pollAttempts++;
      const currentTabs = get(tabs);
      const tab = currentTabs.find((t) => t.id === tabId);
      // Stop polling if the tab was removed or we've exceeded a reasonable timeout (10s)
      if (!tab || pollAttempts > 100) {
        clearInterval(poll);
        return;
      }
      if (tab.type === "terminal" && tab.ptyId >= 0) {
        clearInterval(poll);
        const skip = get(skipPermissions) ? " --dangerously-skip-permissions" : "";
        let cmd: string;
        if (resumeId) {
          cmd = `claude --resume ${resumeId}${skip}\n`;
        } else {
          cmd = `claude --session-id ${claudeSessionId}${skip}\n`;
        }
        // Small delay to let the shell prompt render
        setTimeout(() => {
          ptyWrite(tab.ptyId, cmd);
          tabs.update((t) =>
            t.map((x) => (x.id === tabId && x.type === "terminal" ? { ...x, commandWrittenAt: Date.now() } : x)),
          );
          updateSessionStatus(session.id, "running");
          // Readiness is triggered by TerminalSession detecting Claude Code's
          // OSC title (after a 300ms gate to skip shell-emitted titles) or
          // alternate screen buffer activation. Safety fallback after 5s.
          setTimeout(() => {
            const current = get(tabs).find((t) => t.id === tabId);
            if (current?.type === "terminal" && current.ready === false) {
              setTabReady(tabId);
            }
          }, 5000);
        }, 300);
      }
    }, 100);

    return session;
  }
</script>

<div class="app">
  <div class="sidebar" style="width: {sidebarWidth}px">
  <AgentManager
    workspaces={$workspaces}
    activeWorkspacePath={$activeWorkspacePath}
    activeSessionId={$activeSessionId}
    {openTabIds}
    on:newTerminal={() => {
      const id = crypto.randomUUID();
      const terminal = new Terminal();
      const wsPath = get(activeWorkspacePath);
      addTab({ type: "terminal", id, title: "Terminal", ptyId: -1, terminal, cwd: wsPath || undefined });
    }}
    on:openPrs={() => {
      // Toggle: if the PRs tab is already showing, return to the
      // previously active tab. Otherwise activate it (creating the
      // singleton on the fly if the pre-spawn somehow hasn't happened).
      const existing = get(tabs).find((t) => t.type === "terminal" && t.role === "prs");
      const id = existing ? existing.id : spawnPrsTab(false);
      if (get(activeTabId) === id) {
        activeTabId.set(prevTabBeforePrs);
      } else {
        prevTabBeforePrs = get(activeTabId);
        activeTabId.set(id);
      }
      runPrsOnce(id);
    }}
    on:addWorkspace={async () => {
      const selected = await open({ directory: true, multiple: false, title: "Select workspace folder" });
      if (typeof selected === "string") await storeAddWorkspace(selected);
    }}
    on:newSession={(e) => {
      spawnClaudeSession(e.detail.workspacePath);
    }}
    on:selectSession={(e) => {
      activeWorkspacePath.set(e.detail.workspacePath);
      activeSessionId.set(e.detail.sessionId);
      const ws = get(workspaces).find((w) => w.path === e.detail.workspacePath);
      const session = ws?.sessions.find((s) => s.id === e.detail.sessionId);
      if (!session) return;

      if (spawningSessionIds.has(session.id)) return;

      // If the session is running and has a terminal tab, switch to it
      if (session.terminalTabId && session.status === "running") {
        const existing = get(tabs).find((t) => t.id === session.terminalTabId);
        if (existing) {
          activeTabId.set(existing.id);
          return;
        }
      }

      // Spawn/resume if not actively running (or running with a missing tab)
      if (session.status !== "running" || !get(tabs).find((t) => t.id === session.terminalTabId)) {
        spawningSessionIds.add(session.id);
        const resumeId = session.claudeSessionId ?? undefined;
        spawnClaudeSession(e.detail.workspacePath, resumeId, session.id)
          .finally(() => spawningSessionIds.delete(session.id));
      }
    }}
    on:deleteSession={async (e) => {
      const { workspacePath, sessionId } = e.detail;
      const ws = get(workspaces).find((w) => w.path === workspacePath);
      const session = ws?.sessions.find((s) => s.id === sessionId);
      // Close the terminal tab if the session is open
      if (session?.terminalTabId) {
        const tab = get(tabs).find((t) => t.id === session.terminalTabId);
        if (tab && tab.type === "terminal" && tab.ptyId >= 0) {
          try { await ptyKill(tab.ptyId); } catch {}
        }
        if (tab) removeTab(tab.id);
      }
      await removeSession(workspacePath, sessionId);
    }}
    on:selectWorkspace={(e) => {
      activeWorkspacePath.set(e.detail.workspacePath);
    }}
    on:setWorkspaceColor={(e) => {
      setWorkspaceColor(e.detail.workspacePath, e.detail.color);
    }}
    on:deleteWorkspace={async (e) => {
      const { workspacePath } = e.detail;
      const ws = get(workspaces).find((w) => w.path === workspacePath);
      if (ws) {
        for (const session of ws.sessions) {
          if (session.terminalTabId) {
            const tab = get(tabs).find((t) => t.id === session.terminalTabId);
            if (tab && tab.type === "terminal" && tab.ptyId >= 0) {
              try { await ptyKill(tab.ptyId); } catch {}
            }
            if (tab) removeTab(tab.id);
          }
        }
      }
      await removeWorkspace(workspacePath);
      if (get(activeWorkspacePath) === workspacePath) {
        activeWorkspacePath.set("");
        activeSessionId.set("");
      }
    }}
  />
  </div>
  <Resizer onResize={handleSidebarResize} />
  <div class="main-stage" bind:clientWidth={mainStageWidth}>
    <div class="terminal-section">
      <TerminalContainer />
    </div>
    {#if $panelVisible}
      <Resizer onResize={handleResize} onDragStart={handleResizeStart} onDragEnd={handleResizeEnd} />
      <div class="panel-section" class:resizing={isResizing} style="width: {panelWidth}px">
        <SidePanel />
      </div>
    {/if}
  </div>
</div>
<SettingsModal />
<Toast />

<style>
  :global(:root) {
    /* Everforest Hard Dark palette — canonical values
       Contrast targets (against bg0 #272e33):
         fg #d3c6aa  → 7.97:1  AAA  (default body, headings)
         grey2       → 5.36:1  AA   (captions, hints)
         primary     → 6.92:1  AAA  (links, accents)
       Surface hierarchy (tonal depth) */
    --surface: #272e33;              /* bg0 */
    --surface-container-lowest: #1e2326; /* bg_dim */
    --surface-container-low: #2e383c;  /* bg1 */
    --surface-container: #374145;     /* bg2 */
    --surface-container-high: #414b50; /* bg3 */
    --surface-container-highest: #495156; /* bg4 */
    --surface-bright: #4f5b58;       /* bg5 */

    /* Foreground */
    --on-surface: #d3c6aa;           /* fg — AAA on bg0 */
    --on-surface-variant: #9da9a0;   /* grey2 — AA on bg0 */

    /* Outline — at least 3:1 against surface for non-text contrast */
    --outline-variant: #7a8478;      /* grey0 — 3.66:1 on bg0 */

    /* Primary (blue) */
    --primary: #7fbbb3;
    --primary-container: #6ba89f;
    --on-primary: #272e33;
    --primary-dim: #5a948c;

    /* Secondary (green) */
    --secondary: #a7c080;
    --secondary-container: #404d44; /* bg_green */

    /* Error (red) */
    --error: #e67e80;
    --error-container: #4e3e43;     /* bg_red */

    /* Tertiary (orange) */
    --tertiary: #e69875;

    /* Named colors */
    --yellow: #dbbc7f;
    --cyan: #83c092;
    --amber: #e69875;

    /* Radius */
    --radius: 8px;
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;

    /* Spacing scale */
    --spacing-2-5: 0.5rem;
    --spacing-4: 0.9rem;
    --spacing-5: 1.1rem;

    /* Typography */
    --font-display: "Space Grotesk Variable", "Space Grotesk", sans-serif;
    --font-body: "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: "JetBrains Mono Variable", "JetBrains Mono", "Fira Code", Menlo, monospace;

    font-size: 115%;
  }

  /* Everforest Hard Light — applied when the OS is in light mode.
     Contrast targets (against bg0 #fffbef):
       on-surface #3a464c → 10.3:1  AAA   (default body)
       grey1     #939f91 → 3.28:1  large/icon only
       primary   #3a94c5 → 3.91:1  AA-large + non-text
       error     #f85552 → 3.69:1  non-text contrast
     Hard light uses #fffbef (warm bg0); we slightly cool the fg vs the
     Everforest grey scale so body text comfortably clears AAA. */
  @media (prefers-color-scheme: light) {
    :global(:root) {
      --surface: #fffbef;              /* bg0 */
      --surface-container-lowest: #f3ead3; /* bg_dim */
      --surface-container-low: #f8f5e4;  /* bg1 */
      --surface-container: #f2efdf;     /* bg2 */
      --surface-container-high: #edeada; /* bg3 */
      --surface-container-highest: #e6e2cc; /* bg4 */
      --surface-bright: #bec5b2;        /* bg5 */

      --on-surface: #3a464c;            /* darker than Everforest fg for AAA */
      --on-surface-variant: #5c6a72;    /* Everforest fg — AA on bg0 */

      --outline-variant: #939f91;       /* grey1 — 3.28:1 non-text */

      --primary: #3a94c5;
      --primary-container: #2b7faa;
      --on-primary: #fffbef;
      --primary-dim: #2f7ea6;

      --secondary: #8da101;
      --secondary-container: #e5e6c5;   /* bg_green */

      --error: #f85552;
      --error-container: #fbe3da;       /* bg_red */

      --tertiary: #f57d26;

      --yellow: #dfa000;
      --cyan: #35a77c;
      --amber: #f57d26;
    }
  }

  /* Keep terminal at its own font size — xterm manages this internally */
  :global(.xterm) {
    font-size: initial;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: var(--surface);
    color: var(--on-surface);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(::selection) {
    background: color-mix(in srgb, var(--primary) 35%, transparent);
    color: var(--on-surface);
  }

  :global(.material-symbols-outlined) {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    font-size: 1.25rem;
    vertical-align: middle;
  }

  :global(::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: color-mix(in srgb, var(--outline-variant) 50%, transparent);
    border-radius: 3px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--outline-variant);
  }

  .app {
    display: flex;
    height: 100vh;
    width: 100vw;
  }

  .sidebar {
    flex-shrink: 0;
    height: 100%;
    overflow: hidden;
  }

  .main-stage {
    flex: 1;
    display: flex;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }

  .terminal-section {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .panel-section {
    flex-shrink: 0;
    overflow: hidden;
    border-left: 1px solid var(--outline-variant);
    contain: inline-size layout style;
  }

  .panel-section.resizing {
    pointer-events: none;
    will-change: width;
  }

</style>
