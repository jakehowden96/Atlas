<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import SidePanel from "./lib/components/panel/SidePanel.svelte";
  import Resizer from "./lib/components/layout/Resizer.svelte";
  import { mountPanelLayout, type PanelLayout } from "./lib/panel-layout";
  import AgentManager from "./lib/components/layout/AgentManager.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import SettingsModal from "./lib/components/panel/SettingsModal.svelte";
  import { panelVisible, panelData, checkApiStatus } from "./lib/stores/panel";
  import { getAdapter } from "./lib/adapters";
  import { selectedTool, getToolSettings } from "./lib/stores/settings";
  import { tabs, activeTabId, addTab, removeTab, setTabNeedsInput, setTabReady, chromeHeight, tabBarHeight } from "./lib/stores/terminal";
  import { onPanelUpdate, onToolNotification, ptyWrite, ptyKill } from "./lib/ipc";
  import { enableNotifications, loadSettings } from "./lib/stores/settings";
  import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
  import {
    workspaces,
    activeWorkspacePath,
    activeSessionId,
    loadWorkspaces,
    addWorkspace as storeAddWorkspace,
    addSession,
    setToolSessionId,
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

  let stageEl: HTMLDivElement | undefined = $state();
  let panelLayout: PanelLayout | null = null;
  let panelWidth = $state(0);
  let panelWidthUnsub: (() => void) | null = null;
  let sidebarWidth = $state(280);
  let isResizing = $state(false);
  let unlisten: UnlistenFn | null = null;
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

  $effect(() => {
    if ($activeTabId) {
      setTabNeedsInput($activeTabId, false);
    }
  });

  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 480;

  function handleResize(delta: number) {
    panelLayout?.nudge(delta);
  }

  function handleSidebarResize(delta: number) {
    sidebarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth - delta));
  }

  function handleResizeStart() { isResizing = true; }
  function handleResizeEnd() { isResizing = false; }

  onMount(async () => {
    await log.init();
    log.info("app", "onMount started");
    await tick();
    if (stageEl) {
      panelLayout = mountPanelLayout(stageEl);
      panelWidthUnsub = panelLayout.panelWidth$.subscribe((w) => { panelWidth = w; });
    }
    checkApiStatus();
    await Promise.all([loadWorkspaces(), loadSettings()]);
    const ws = get(workspaces);
    log.info("app", `workspaces loaded: ${ws.length}`);
    if (ws.length > 0 && !get(activeWorkspacePath)) {
      activeWorkspacePath.set(ws[0].path);
      log.info("app", `active workspace set: ${ws[0].path}`);
    }
    unlisten = await onPanelUpdate((sessionId, data) => {
      if (sessionId === get(activeTabId)) {
        panelData.set(data);
      }
    });
    unlistenNotification = await onToolNotification(async (event) => {
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
              title: notification.title || "Agent needs input",
              body: notification.message || "A session is waiting for your response",
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
    panelWidthUnsub?.();
    panelLayout?.destroy();
  });

  async function spawnToolSession(workspacePath: string, resumeId?: string, existingSessionId?: string) {
    const tabId = crypto.randomUUID();
    const adapter = getAdapter(get(selectedTool));
    const adapterSettings = getToolSettings(get(selectedTool));
    let session: { id: string };
    let toolSessionId: string | undefined;

    const resumeResult = resumeId
      ? adapter.buildResumeCommand({ toolSessionId: resumeId, settings: adapterSettings })
      : null;
    const useStreamJson = resumeResult
      ? (resumeResult.useStreamJson ?? adapter.supportsStreamJson)
      : adapter.supportsStreamJson;

    if (existingSessionId) {
      await resumeSession(existingSessionId, tabId);
      session = { id: existingSessionId };
    } else {
      const wsName = get(workspaces).find((w) => w.path === workspacePath)?.name
        ?? stripBundleExtension(workspacePath.split("/").filter(Boolean).pop() ?? "New session");
      session = await addSession(workspacePath, wsName, tabId);
    }

    // For per-turn adapters, generate toolSessionId upfront (no command written yet)
    if (adapter.perTurnInvocation && !resumeId) {
      const result = adapter.buildNewSessionCommand({ sessionId: tabId, settings: adapterSettings });
      toolSessionId = result.toolSessionId;
      if (toolSessionId) {
        await setToolSessionId(session.id, toolSessionId);
      }
    }
    if (resumeId) {
      toolSessionId = resumeId;
    }

    addTab({
      type: "terminal",
      id: tabId,
      title: "",
      ptyId: -1,
      cwd: workspacePath,
      ready: false,
      useStreamJson,
      perTurnInvocation: adapter.perTurnInvocation ?? false,
      adapterId: adapter.id,
      toolSessionId,
      turnCount: resumeId ? 1 : 0,
    });

    let pollAttempts = 0;
    const poll = setInterval(async () => {
      pollAttempts++;
      const currentTabs = get(tabs);
      const tab = currentTabs.find((t) => t.id === tabId);
      if (!tab || pollAttempts > 100) {
        clearInterval(poll);
        return;
      }
      if (tab.type === "terminal" && tab.ptyId >= 0) {
        clearInterval(poll);

        if (adapter.perTurnInvocation) {
          updateSessionStatus(session.id, "running");
          setTabReady(tabId);
        } else {
          let cmd: string;
          if (resumeResult) {
            cmd = resumeResult.command;
          } else {
            const result = adapter.buildNewSessionCommand({ sessionId: tabId, settings: adapterSettings });
            cmd = result.command;
            toolSessionId = result.toolSessionId;
            if (toolSessionId) {
              await setToolSessionId(session.id, toolSessionId);
            }
          }
          setTimeout(() => {
            ptyWrite(tab.ptyId, cmd);
            tabs.update((t) =>
              t.map((x) => (x.id === tabId && x.type === "terminal" ? { ...x, commandWrittenAt: Date.now() } : x)),
            );
            updateSessionStatus(session.id, "running");
            if (useStreamJson) {
              setTabReady(tabId);
            } else {
              setTimeout(() => {
                const current = get(tabs).find((t) => t.id === tabId);
                if (current?.type === "terminal" && current.ready === false) {
                  setTabReady(tabId);
                }
              }, 5000);
            }
          }, 300);
        }
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
      const wsPath = get(activeWorkspacePath);
      addTab({ type: "terminal", id, title: "Terminal", ptyId: -1, cwd: wsPath || undefined });
    }}
    on:addWorkspace={async () => {
      const selected = await open({ directory: true, multiple: false, title: "Select workspace folder" });
      if (typeof selected === "string") await storeAddWorkspace(selected);
    }}
    on:newSession={(e) => {
      spawnToolSession(e.detail.workspacePath);
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
        const resumeId = session.toolSessionId ?? undefined;
        spawnToolSession(e.detail.workspacePath, resumeId, session.id)
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
  <div bind:this={stageEl} class="main-stage" class:has-tabs={$tabs.length > 0} style="--chrome-height: {$chromeHeight}px; --tab-bar-height: {$tabBarHeight}px">
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
