<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import TerminalContainer from "./lib/components/terminal/TerminalContainer.svelte";
  import SidePanel from "./lib/components/panel/SidePanel.svelte";
  import Resizer from "./lib/components/layout/Resizer.svelte";
  import AgentManager from "./lib/components/layout/AgentManager.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import { Terminal } from "@xterm/xterm";
  import { panelVisible, panelData, togglePanel, checkApiStatus, analysisStatus, analysisError } from "./lib/stores/panel";
  import { tabs, activeTabId, addTab } from "./lib/stores/terminal";
  import { onPanelUpdate, onAnalysisStatus, ptyWrite } from "./lib/ipc";
  import {
    workspaces,
    activeWorkspacePath,
    activeSessionId,
    loadWorkspaces,
    addWorkspace as storeAddWorkspace,
    addSession,
    setClaudeSessionId,
    updateSessionStatus,
  } from "./lib/stores/workspace";
  import { open } from "@tauri-apps/plugin-dialog";
  import { get } from "svelte/store";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let panelWidth = $state(420);
  let unlisten: UnlistenFn | null = null;
  let unlistenStatus: UnlistenFn | null = null;

  // Show panel when there's panel data AND active sessions
  $effect(() => {
    panelVisible.set(!!$panelData && $tabs.length > 0);
  });

  const MIN_PANEL_WIDTH = 280;
  const MAX_PANEL_WIDTH = 800;

  function handleResize(delta: number) {
    panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, panelWidth + delta));
  }

  onMount(async () => {
    checkApiStatus();
    loadWorkspaces();
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
  });

  onDestroy(() => {
    unlisten?.();
    unlistenStatus?.();
  });

  /**
   * Spawn a terminal tab in the given workspace directory, run `claude`
   * (or `claude --resume <id>` for existing sessions), and capture the
   * Claude session ID from stdout so the session can be resumed later.
   */
  function spawnClaudeSession(workspacePath: string, resumeId?: string) {
    const tabId = crypto.randomUUID();
    const terminal = new Terminal();
    const label = resumeId ? `Resumed session` : `New session`;
    const session = addSession(workspacePath, label, tabId);

    // Buffer PTY output to detect the Claude session ID.
    // Claude Code prints a line like:  Session: <uuid>
    let captured = false;
    let outputBuf = "";

    const onData = (data: string) => {
      if (captured) return;
      outputBuf += data;
      // Claude Code outputs the session id in the format "session: <id>" early on
      const match = outputBuf.match(/(?:session:\s+|Session ID:\s+|--resume\s+)([a-f0-9-]{36})/i);
      if (match) {
        captured = true;
        setClaudeSessionId(session.id, match[1]);
      }
      // Stop buffering after 8 KB to avoid unbounded memory
      if (outputBuf.length > 8192) {
        captured = true;
      }
    };

    addTab({ type: "terminal", id: tabId, title: "", ptyId: -1, terminal, cwd: workspacePath, onData });

    // Once the PTY is ready, send the claude command.
    // We watch for the ptyId to become available via a short poll since
    // handlePtyReady fires inside TerminalContainer.
    const poll = setInterval(async () => {
      const currentTabs = get(tabs);
      const tab = currentTabs.find((t) => t.id === tabId);
      if (tab && tab.type === "terminal" && tab.ptyId >= 0) {
        clearInterval(poll);
        const cmd = resumeId ? `claude --resume ${resumeId}\n` : `claude\n`;
        // Small delay to let the shell prompt render
        setTimeout(() => ptyWrite(tab.ptyId, cmd), 300);
      }
    }, 100);

    return session;
  }
</script>

<div class="app">
  <AgentManager
    workspaces={$workspaces}
    activeWorkspacePath={$activeWorkspacePath}
    activeSessionId={$activeSessionId}
    on:addWorkspace={async () => {
      const selected = await open({ directory: true, multiple: false, title: "Select workspace folder" });
      if (typeof selected === "string") storeAddWorkspace(selected);
    }}
    on:newSession={(e) => {
      spawnClaudeSession(e.detail.workspacePath);
    }}
    on:selectSession={(e) => {
      activeWorkspacePath.set(e.detail.workspacePath);
      activeSessionId.set(e.detail.sessionId);
      // Find the session and resume it if it has a Claude session ID
      const ws = get(workspaces).find((w) => w.path === e.detail.workspacePath);
      const session = ws?.sessions.find((s) => s.id === e.detail.sessionId);
      if (session?.claudeSessionId && session.status !== "running") {
        spawnClaudeSession(e.detail.workspacePath, session.claudeSessionId);
      }
    }}
    on:selectWorkspace={(e) => {
      activeWorkspacePath.set(e.detail.workspacePath);
    }}
  />
  <div class="main-stage">
    <div class="terminal-section">
      <TerminalContainer />
    </div>
    {#if $panelVisible}
      <Resizer onResize={handleResize} />
      <div class="panel-section" style="width: {panelWidth}px">
        <SidePanel />
      </div>
    {/if}
  </div>
</div>
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

    /* Chrome bar height (shared between terminal + panel) */
    --chrome-height: 52px;

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

  .main-stage {
    flex: 1;
    display: flex;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }

  .main-stage::after {
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
  }

</style>
