<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { ptySpawn, ptyWrite, ptyResize, ptyKill, refreshPanel } from "../../ipc";
  import { setTabTitle } from "../../stores/terminal";
  import { panelData } from "../../stores/panel";
  import { handleGlobalKeydown, setRefreshHandler } from "../../shortcuts";
  import "@xterm/xterm/css/xterm.css";

  interface Props {
    tabId: string;
    visible: boolean;
    onPtyReady: (ptyId: number) => void;
  }

  let { tabId, visible, onPtyReady }: Props = $props();

  let containerEl: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let ptyId: number | null = null;
  let resizeObserver: ResizeObserver;
  let currentCwd: string = "";
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Debounced panel refresh — avoids hammering git on rapid CWD changes
  function scheduleRefresh(cwd: string) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const data = await refreshPanel(tabId, cwd);
      if (data) {
        panelData.set(data);
      }
    }, 300);
  }

  onMount(async () => {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
        black: "#32344a",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#ad8ee6",
        cyan: "#449dab",
        white: "#787c99",
        brightBlack: "#444b6a",
        brightRed: "#ff7a93",
        brightGreen: "#b9f27c",
        brightYellow: "#ff9e64",
        brightBlue: "#7da6ff",
        brightMagenta: "#bb9af7",
        brightCyan: "#0db9d7",
        brightWhite: "#acb0d0",
      },
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerEl);

    // Try WebGL, fall back to canvas
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, canvas renderer is fine
    }

    fitAddon.fit();

    // Intercept keyboard shortcuts before terminal processes them
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;

      // Ctrl+T: new tab
      if (e.ctrlKey && !e.shiftKey && e.key === "t") {
        return false; // Let it bubble to global handler
      }

      // Ctrl+W: close tab
      if (e.ctrlKey && !e.shiftKey && e.key === "w") {
        return false;
      }

      // Handle global shortcuts
      if (handleGlobalKeydown(e)) {
        return false;
      }

      return true; // Let terminal handle it
    });

    // Parse OSC sequences for tab title
    terminal.parser.registerOscHandler(0, (data) => {
      setTabTitle(tabId, data);
      return true;
    });
    terminal.parser.registerOscHandler(2, (data) => {
      setTabTitle(tabId, data);
      return true;
    });

    // OSC 7: CWD reporting — shells emit this when the directory changes
    // Format: file://hostname/path/to/dir
    terminal.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data);
        const cwd = decodeURIComponent(url.pathname);
        if (cwd && cwd !== currentCwd) {
          currentCwd = cwd;
          scheduleRefresh(cwd);
        }
      } catch {
        // Not a valid URL — some shells send just the path
        const cwd = data.trim();
        if (cwd && cwd !== currentCwd) {
          currentCwd = cwd;
          scheduleRefresh(cwd);
        }
      }
      return true;
    });

    // Spawn PTY
    const cols = terminal.cols;
    const rows = terminal.rows;

    ptyId = await ptySpawn(cols, rows, (data) => {
      terminal.write(data);
    }, undefined, { FORGE_SESSION_ID: tabId });

    onPtyReady(ptyId);

    // Forward terminal input to PTY
    terminal.onData((data) => {
      if (ptyId !== null) {
        ptyWrite(ptyId, data);
      }
    });

    // Handle resize
    resizeObserver = new ResizeObserver(() => {
      if (visible) {
        fitAddon.fit();
        if (ptyId !== null) {
          ptyResize(ptyId, terminal.cols, terminal.rows);
        }
      }
    });
    resizeObserver.observe(containerEl);

    // Also refresh on every command (heuristic: after Enter key, wait a beat)
    // This catches cases where OSC 7 isn't emitted (e.g. git commit)
    terminal.onData((data) => {
      if (data === "\r" && currentCwd) {
        // User pressed Enter — refresh after a short delay to let the command run
        setTimeout(() => {
          if (currentCwd) scheduleRefresh(currentCwd);
        }, 1000);
      }
    });
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (refreshTimer) clearTimeout(refreshTimer);
    if (ptyId !== null) {
      ptyKill(ptyId);
    }
    terminal?.dispose();
  });

  // Refit when becoming visible, and refresh panel
  $effect(() => {
    if (visible && fitAddon) {
      requestAnimationFrame(() => {
        fitAddon.fit();
        if (ptyId !== null) {
          ptyResize(ptyId, terminal.cols, terminal.rows);
        }
      });
      // Refresh panel when tab becomes visible
      if (currentCwd) {
        scheduleRefresh(currentCwd);
      }
      // Register this tab's refresh handler for Ctrl+Shift+R
      setRefreshHandler(() => {
        if (currentCwd) scheduleRefresh(currentCwd);
      });
    }
  });
</script>

<div
  class="terminal-container"
  class:hidden={!visible}
  bind:this={containerEl}
></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .terminal-container.hidden {
    display: none;
  }

  .terminal-container :global(.xterm) {
    padding: 8px;
    height: 100%;
  }
</style>
