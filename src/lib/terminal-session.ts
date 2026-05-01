import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, refreshPanel, getPanelData } from "./ipc";
import { setTabTitle, activeTabId, setTabNeedsInput, setTabReady, tabs } from "./stores/terminal";
import { panelData, analysisStatus, analysisError } from "./stores/panel";
import type { PanelData } from "../types/panel";
import { updateSessionLabelByTabId } from "./stores/workspace";
import { get } from "svelte/store";
import { showToast } from "./stores/toast";
import { setRefreshHandler } from "./shortcuts";
import { xtermTheme } from "./theme";
import { log } from "./logger";
import { panelDataChanged, parseOsc7Cwd } from "./terminal-utils";

export interface TerminalSessionOptions {
  tabId: string;
  container?: HTMLDivElement;
  visible: boolean;
  onPtyReady: (ptyId: number) => void;
  cwd?: string;
  onData?: (data: string) => void;
  headless?: boolean;
}

export class TerminalSession {
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private ptyId: number | null = null;
  private currentCwd = "";
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tabId: string;
  private _visible: boolean;
  private initialCwd?: string;
  private externalOnData?: (data: string) => void;
  private headless: boolean;
  private decoder = new TextDecoder();

  constructor(opts: TerminalSessionOptions) {
    this.tabId = opts.tabId;
    this._visible = opts.visible;
    this.initialCwd = opts.cwd;
    this.currentCwd = opts.cwd ?? "";
    this.externalOnData = opts.onData;
    this.headless = opts.headless ?? false;

    if (!this.headless && opts.container) {
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
      this.registerReadinessHandler();
      this.setupResizeObserver(opts.container);
      this.setupEnterRefresh();
    }

    this.spawnPty(opts.onPtyReady);
    if (this._visible) this.startPolling();
  }

  private registerKeyHandler() {
    this.terminal!.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      // Pass through global shortcuts to the window-level handler — returning
      // false prevents xterm from consuming the key so it bubbles up to
      // TerminalContainer's <svelte:window onkeydown>.  We must NOT call
      // handleGlobalKeydown here because the window handler already does,
      // which would cause actions like openFile to fire twice.
      if (e.ctrlKey && e.key === "Tab") return false;
      if (e.ctrlKey && !e.shiftKey && e.key === "t") return false;
      if (e.ctrlKey && !e.shiftKey && e.key === "w") return false;
      if (e.ctrlKey && !e.shiftKey && e.key === "o") return false;
      if (e.ctrlKey && !e.shiftKey && e.key === "s") return false;
      if (e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") return false;
      // All Ctrl+Shift combos are global shortcuts (panel toggle, section
      // switching, manual refresh) — pass them all through rather than
      // maintaining a duplicate list that drifts from shortcuts.ts.
      if (e.ctrlKey && e.shiftKey) return false;
      return true;
    });
  }

  private checkOscReadiness() {
    const tab = get(tabs).find(t => t.id === this.tabId);
    if (tab?.type === "terminal" && tab.commandWrittenAt && !tab.ready) {
      // 300ms gate: shell preexec hooks fire within ~50ms of command entry;
      // Claude Code's title arrives 500ms+ later. This cleanly separates them.
      if (Date.now() - tab.commandWrittenAt > 300) {
        setTabReady(this.tabId);
      }
    }
  }

  private registerOscHandlers() {
    const term = this.terminal!;
    const handleTitleOsc = (data: string) => {
      setTabTitle(this.tabId, data, "osc");
      this.checkOscReadiness();
      updateSessionLabelByTabId(this.tabId, data);
      return true;
    };
    term.parser.registerOscHandler(0, handleTitleOsc);
    term.parser.registerOscHandler(2, handleTitleOsc);

    term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7Cwd(data);
      if (cwd && cwd !== this.currentCwd) {
        this.currentCwd = cwd;
        this.scheduleRefresh(cwd);
      }
      return true;
    });
  }

  /**
   * Detect when a TUI app (Claude Code) activates the alternate screen buffer
   * via CSI ? 1049 h. This is a deterministic signal that the TUI has started,
   * unlike OSC title sequences which shells also emit.
   */
  private registerReadinessHandler() {
    this.terminal!.parser.registerCsiHandler({ final: "h", prefix: "?" }, (params) => {
      if (params.includes(1049)) {
        const tab = get(tabs).find(t => t.id === this.tabId);
        if (tab?.type === "terminal" && tab.ready === false) {
          setTabReady(this.tabId);
        }
      }
      return false; // don't consume — let xterm process the sequence normally
    });
  }

  /** Re-fit the terminal and sync PTY dimensions. Call after layout changes. */
  fitTerminal() {
    if (this.headless || !this.terminal || !this.fitAddon) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.terminal || !this.fitAddon) return;
        this.fitAddon.fit();
        this.terminal.focus();
        if (this.ptyId !== null) {
          ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
        }
      });
    });
  }

  private setupResizeObserver(container: HTMLDivElement) {
    this.resizeObserver = new ResizeObserver(() => {
      if (this._visible && this.fitAddon && this.terminal) {
        this.fitAddon.fit();
        if (this.ptyId !== null) {
          ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
        }
      }
    });
    this.resizeObserver.observe(container);
  }

  private async spawnPty(onPtyReady: (ptyId: number) => void) {
    log.info("terminal", `spawnPty tab=${this.tabId} cwd=${this.initialCwd ?? "default"} headless=${this.headless}`);
    const cols = this.terminal?.cols ?? 120;
    const rows = this.terminal?.rows ?? 40;

    try {
      this.ptyId = await ptySpawn(
        cols,
        rows,
        (data) => {
          if (!this.headless && this.terminal) {
            this.terminal.write(data);
          }
          if (this.externalOnData) {
            this.externalOnData(this.decoder.decode(data, { stream: true }));
          }
        },
        this.initialCwd ?? undefined,
        { ATLAS_SESSION_ID: this.tabId },
      );
      log.info("terminal", `spawnPty success: ptyId=${this.ptyId}`);
      onPtyReady(this.ptyId);
    } catch (e) {
      log.error("terminal", `spawnPty failed for tab=${this.tabId}`, e);
      showToast(`Failed to spawn terminal: ${e}`);
      return;
    }

    if (!this.headless && this.terminal) {
      this.terminal.onData((data) => {
        if (this.ptyId !== null) {
          ptyWrite(this.ptyId, data);
        }
        setTabNeedsInput(this.tabId, false);
      });
    }
  }

  async writeCommand(cmd: string) {
    if (this.ptyId !== null) {
      await ptyWrite(this.ptyId, cmd);
    }
  }

  private setupEnterRefresh() {
    this.terminal!.onData((data) => {
      if (data === "\r" && this.currentCwd) {
        setTimeout(() => {
          if (this.currentCwd) this.scheduleRefresh(this.currentCwd);
        }, 1000);
      }
    });
  }

  private lastPanelVersion = -1;
  private lastPanelDiffRaw: string | null = null;

  private panelChanged(data: PanelData | null): boolean {
    return panelDataChanged(data, this.lastPanelVersion, this.lastPanelDiffRaw);
  }

  private updatePanelFingerprint(data: PanelData | null) {
    this.lastPanelVersion = data?.version ?? -1;
    this.lastPanelDiffRaw = data?.diff?.raw ?? null;
  }

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

        if (this.panelChanged(data)) {
          this.updatePanelFingerprint(data);
          panelData.set(data);
        }
      } catch (e) {
        log.error("terminal", `panel refresh failed for tab=${this.tabId}`, e);
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
    }, 30000);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  handleVisibilityChange(visible: boolean) {
    const wasVisible = this._visible;
    this._visible = visible;

    if (!visible) {
      this.stopPolling();
      return;
    }

    // No-op if already visible (e.g. duplicate effect fire)
    if (wasVisible) return;

    // First rAF: fit terminal and focus (lightweight, runs in the next paint)
    requestAnimationFrame(() => {
      if (!this._visible) return;
      if (!this.headless && this.terminal && this.fitAddon) {
        this.fitAddon.fit();
        this.terminal.focus();
        if (this.ptyId !== null) {
          ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
        }
      }

      // Second rAF: guarantees a paint between tab highlight and the heavier panel data work
      requestAnimationFrame(() => {
        if (!this._visible) return;
        if (this.currentCwd) {
          getPanelData(this.tabId).then((cached) => {
            if (get(activeTabId) !== this.tabId) return;
            if (this.panelChanged(cached)) {
              this.updatePanelFingerprint(cached);
              panelData.set(cached);
            }
          }).catch((e) => { log.warn("terminal", `getPanelData failed for tab=${this.tabId}: ${e}`); });
          this.scheduleRefresh(this.currentCwd);
        } else {
          panelData.set(null);
        }
        setRefreshHandler(() => {
          if (this.currentCwd) this.scheduleRefresh(this.currentCwd);
        });
        this.startPolling();
      });
    });
  }

  destroy() {
    log.info("terminal", `destroy tab=${this.tabId} ptyId=${this.ptyId}`);
    this.resizeObserver?.disconnect();
    this.stopPolling();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.ptyId !== null) {
      ptyKill(this.ptyId, this.tabId);
    }
    if (this.terminal) this.terminal.dispose();
  }
}
