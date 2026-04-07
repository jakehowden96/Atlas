import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, refreshPanel } from "./ipc";
import { setTabTitle, activeTabId } from "./stores/terminal";
import { panelData, analysisStatus, analysisError } from "./stores/panel";
import { get } from "svelte/store";
import { showToast } from "./stores/toast";
import { handleGlobalKeydown, setRefreshHandler } from "./shortcuts";
import { xtermTheme } from "./theme";

export interface TerminalSessionOptions {
  tabId: string;
  container: HTMLDivElement;
  visible: boolean;
  onPtyReady: (ptyId: number) => void;
  cwd?: string;
  onData?: (data: string) => void;
}

export class TerminalSession {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private resizeObserver: ResizeObserver | null = null;
  private ptyId: number | null = null;
  private currentCwd = "";
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tabId: string;
  private _visible: boolean;
  private initialCwd?: string;
  private externalOnData?: (data: string) => void;

  constructor(opts: TerminalSessionOptions) {
    this.tabId = opts.tabId;
    this._visible = opts.visible;
    this.initialCwd = opts.cwd;
    this.externalOnData = opts.onData;

    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: xtermTheme,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(opts.container);

    try {
      this.terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, canvas renderer is fine
    }

    this.fitAddon.fit();
    this.registerKeyHandler();
    this.registerOscHandlers();
    this.setupResizeObserver(opts.container, opts.visible);
    this.spawnPty(opts.onPtyReady);
    this.setupEnterRefresh();
    if (this._visible) this.startPolling();
  }

  private registerKeyHandler() {
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.key === "Tab") return false;
      if (e.ctrlKey && !e.shiftKey && e.key === "t") return false;
      if (e.ctrlKey && !e.shiftKey && e.key === "w") return false;
      if (handleGlobalKeydown(e)) return false;
      return true;
    });
  }

  private registerOscHandlers() {
    // OSC 0 & 2: tab title
    this.terminal.parser.registerOscHandler(0, (data) => {
      setTabTitle(this.tabId, data);
      return true;
    });
    this.terminal.parser.registerOscHandler(2, (data) => {
      setTabTitle(this.tabId, data);
      return true;
    });

    // OSC 7: CWD reporting — shells emit this when the directory changes
    // Format: file://hostname/path/to/dir
    this.terminal.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data);
        const cwd = decodeURIComponent(url.pathname);
        if (cwd && cwd !== this.currentCwd) {
          this.currentCwd = cwd;
          this.scheduleRefresh(cwd);
        }
      } catch {
        const cwd = data.trim();
        if (cwd && cwd !== this.currentCwd) {
          this.currentCwd = cwd;
          this.scheduleRefresh(cwd);
        }
      }
      return true;
    });
  }

  private setupResizeObserver(container: HTMLDivElement, _visible: boolean) {
    this.resizeObserver = new ResizeObserver(() => {
      if (this._visible) {
        this.fitAddon.fit();
        if (this.ptyId !== null) {
          ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
        }
      }
    });
    this.resizeObserver.observe(container);
  }

  private async spawnPty(onPtyReady: (ptyId: number) => void) {
    try {
      this.ptyId = await ptySpawn(
        this.terminal.cols,
        this.terminal.rows,
        (data) => {
          this.terminal.write(data);
          if (this.externalOnData) {
            const decoder = new TextDecoder();
            this.externalOnData(decoder.decode(data));
          }
        },
        this.initialCwd ?? undefined,
        { ATLAS_SESSION_ID: this.tabId },
      );
      onPtyReady(this.ptyId);
    } catch (e) {
      showToast(`Failed to spawn terminal: ${e}`);
      return;
    }

    this.terminal.onData((data) => {
      if (this.ptyId !== null) {
        ptyWrite(this.ptyId, data);
      }
    });
  }

  /** Write a string to the PTY (e.g. to run a command). */
  async writeCommand(cmd: string) {
    if (this.ptyId !== null) {
      await ptyWrite(this.ptyId, cmd);
    }
  }

  private setupEnterRefresh() {
    // Refresh panel after Enter key — catches cases where OSC 7 isn't emitted
    this.terminal.onData((data) => {
      if (data === "\r" && this.currentCwd) {
        setTimeout(() => {
          if (this.currentCwd) this.scheduleRefresh(this.currentCwd);
        }, 1000);
      }
    });
  }

  private lastPanelJson: string | null = null;

  private scheduleRefresh(cwd: string) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      try {
        const data = await refreshPanel(this.tabId, cwd);
        if (get(activeTabId) !== this.tabId) return;

        // Preserve summary/flow from async Claude analysis if the refresh
        // returned without them (they arrive later via the file watcher).
        // Only merge if the diff content matches (not just CWD) to prevent
        // cross-tab pollution when multiple tabs share the same repo.
        const existing = get(panelData);
        if (data && existing && data.diff?.raw && data.diff.raw === existing.diff?.raw) {
          if (!data.summary && existing.summary) data.summary = existing.summary;
          if (!data.flow && existing.flow) data.flow = existing.flow;
        }

        // Reset analysis status when context changes (new CWD or new diff)
        const diffChanged = !existing || existing.cwd !== data?.cwd
          || existing.diff?.raw !== data?.diff?.raw;
        if (!data?.summary && diffChanged) {
          analysisStatus.set("idle");
          analysisError.set(null);
        }

        const json = JSON.stringify(data);
        if (json !== this.lastPanelJson) {
          this.lastPanelJson = json;
          panelData.set(data);
        }
      } catch (e) {
        showToast(`Panel refresh failed: ${e}`);
      }
    }, 300);
  }

  private startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      if (this._visible && this.currentCwd) {
        this.scheduleRefresh(this.currentCwd);
      }
    }, 5000);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  handleVisibilityChange(visible: boolean) {
    this._visible = visible;
    if (visible && this.fitAddon) {
      requestAnimationFrame(() => {
        this.fitAddon.fit();
        this.terminal.focus();
        if (this.ptyId !== null) {
          ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
        }
      });
      if (this.currentCwd) {
        this.scheduleRefresh(this.currentCwd);
      } else {
        panelData.set(null);
      }
      setRefreshHandler(() => {
        if (this.currentCwd) this.scheduleRefresh(this.currentCwd);
      });
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.stopPolling();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.ptyId !== null) {
      ptyKill(this.ptyId);
    }
    this.terminal?.dispose();
  }
}
