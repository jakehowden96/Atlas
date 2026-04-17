<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import SidePanel from "./lib/components/panel/SidePanel.svelte";
  import Resizer from "./lib/components/layout/Resizer.svelte";
  import AgentManager from "./lib/components/layout/AgentManager.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import SettingsModal from "./lib/components/panel/SettingsModal.svelte";
  import { Terminal } from "@xterm/xterm";
  import { panelVisible, panelData, checkApiStatus, analysisStatus, analysisError } from "./lib/stores/panel";
  import { tabs, activeTabId, addTab, removeTab, setTabNeedsInput, setTabReady, chromeHeight, tabBarHeight } from "./lib/stores/terminal";
  import { onPanelUpdate, onAnalysisStatus, onClaudeNotification, ptyWrite, ptyKill } from "./lib/ipc";
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
  } from "./lib/stores/workspace";
  import { open } from "@tauri-apps/plugin-dialog";
  import { get } from "svelte/store";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { log } from "./lib/logger";

  let panelWidth = $state(420);
  let sidebarWidth = $state(280);
  let isResizing = $state(false);
  let unlisten: UnlistenFn | null = null;
  let unlistenStatus: UnlistenFn | null = null;
  let unlistenNotification: UnlistenFn | null = null;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const spawningSessionIds = new Set<string>();

  let openTabIds = $derived(new Set($tabs.map(t => t.id)));

  // Show panel only when inside a git workspace.
  // When panelData is null (e.g. during tab switch), keep the current
  // visibility to avoid the panel collapsing and immediately reopening.
  $effect(() => {
    if ($tabs.length === 0) {
      panelVisible.set(false);
    } else if ($panelData !== null) {
      panelVisible.set(!!$panelData.is_git);
    }
  });

  // Clear needsInput when switching to a tab
  $effect(() => {
    if ($activeTabId) {
      setTabNeedsInput($activeTabId, false);
    }
  });

  const MIN_PANEL_WIDTH = 280;
  const MAX_PANEL_WIDTH = 800;
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 480;

  function handleResize(delta: number) {
    panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, panelWidth + delta));
  }

  function handleSidebarResize(delta: number) {
    sidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth - delta));
  }

  function handleResizeStart() { isResizing = true; }
  function handleResizeEnd() { isResizing = false; }

  onMount(async () => {
    await log.init();
    log.info("app", "onMount started");
    log.debug("app", "calling checkApiStatus...");
    checkApiStatus();
    log.debug("app", "calling loadWorkspaces...");
    await loadWorkspaces();
    const ws = get(workspaces);
    log.info("app", `workspaces loaded: ${ws.length}`);
    log.debug("app", `activeWorkspacePath before set: "${get(activeWorkspacePath)}"`);
    if (ws.length > 0 && !get(activeWorkspacePath)) {
      activeWorkspacePath.set(ws[0].path);
      log.info("app", `active workspace set: ${ws[0].path}`);
    } else {
      log.debug("app", `skipped setting active workspace: ws.length=${ws.length}, activeWorkspacePath="${get(activeWorkspacePath)}"`);
    }
    log.debug("app", "calling loadSettings...");
    await loadSettings();
    log.debug("app", "onMount setup complete, attaching listeners...");
    unlisten = await onPanelUpdate((sessionId, data) => {
      if (sessionId === get(activeTabId)) {
        panelData.set(data);
      }
    });
    unlistenStatus = await onAnalysisStatus((event) => {
      if (event.session_id === get(activeTabId)) {
        analysisStatus.set(event.status);
        analysisError.set(event.error ?? null);
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
    unlistenStatus?.();
    unlistenNotification?.();
  });

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
  <div class="main-stage" class:has-tabs={$tabs.length > 0} style="--chrome-height: {$chromeHeight}px; --tab-bar-height: {$tabBarHeight}px">
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
    /* Surface hierarchy (tonal depth) */
    --surface: #0a0e14;
    --surface-container-lowest: #000000;
    --surface-container-low: #0f141a;
    --surface-container-high: #1b2028;
    --surface-container-highest: #20262f;
    --surface-bright: #262c36;

    /* Foreground */
    --on-surface: #f1f3fc;
    --on-surface-variant: #a8abb3;

    /* Outline */
    --outline-variant: #44484f;

    /* Primary */
    --primary: #72b1ff;
    --primary-container: #55a3fc;
    --on-primary: #002f58;
    --primary-dim: #4a8ad4;

    /* Secondary */
    --secondary: #97f999;
    --secondary-container: #006e23;

    /* Error */
    --error: #ff716c;
    --error-container: #9f0519;

    /* Tertiary */
    --tertiary: #ff7167;

    /* Named colors */
    --yellow: #e8be7b;
    --cyan: #63bcc6;
    --amber: #FFA726;

    /* Radius */
    --radius: 8px;
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;

    /* Spacing scale */
    --spacing-2-5: 0.5rem;
    --spacing-4: 0.9rem;
    --spacing-5: 1.1rem;

    /* Additional surface */
    --surface-container: #151a21;

    /* Typography */
    --font-display: "Space Grotesk Variable", "Space Grotesk", sans-serif;
    --font-body: "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: "JetBrains Mono Variable", "JetBrains Mono", "Fira Code", Menlo, monospace;

    font-size: 115%;
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
    color: var(--on-surface-variant);
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

  .main-stage.has-tabs::after {
    content: "";
    position: absolute;
    top: var(--chrome-height);
    left: 0;
    right: 0;
    height: 1px;
    background: var(--outline-variant);
    z-index: 5;
    pointer-events: none;
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
