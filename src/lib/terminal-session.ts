import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, refreshPanel, getPanelData } from "./ipc";
import { setTabTitle, activeTabId, setTabNeedsInput, setTabReady, tabs } from "./stores/terminal";
import { panelData } from "./stores/panel";
import { terminalFontSize } from "./stores/settings";
import type { PanelData } from "../types/panel";
import { updateSessionLabelByTabId } from "./stores/workspace";
import { get } from "svelte/store";
import { showToast } from "./stores/toast";
import { activeXtermTheme, themeMode } from "./theme";
import { log } from "./logger";

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
  private unsubscribeTheme: (() => void) | null = null;
  private unsubscribeFontSize: (() => void) | null = null;
  private prefersDark: MediaQueryList | null = null;

  /** Re-read the palette for the current mode; also fires on OS-preference
      changes so a terminal on "system" follows the OS without a respawn. */
  private applyXtermTheme = () => {
    this.terminal.options.theme = activeXtermTheme(get(themeMode));
  };

  /** Settings' font-size stepper reaches every open terminal through this.
      xterm reflows the buffer on the change, so the pane has to be refit and
      the PTY told its new dimensions. The subscribe fires once immediately
      with the size the terminal was built at, where this is a no-op. */
  private applyFontSize = (size: number) => {
    if (this.terminal.options.fontSize === size) return;
    this.terminal.options.fontSize = size;
    this.fitAddon.fit();
    if (this.ptyId !== null) {
      ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
    }
  };

  constructor(opts: TerminalSessionOptions) {
    this.tabId = opts.tabId;
    this._visible = opts.visible;
    this.initialCwd = opts.cwd;
    this.externalOnData = opts.onData;

    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: get(terminalFontSize),
      /* Claude Code's TUI draws box- and half-block art that must tile
         vertically; a loose line height leaves gaps between rows and breaks
         the banner. 1.2 keeps the pane readable without splitting glyphs. */
      lineHeight: 1.2,
      fontFamily: "'Geist Mono Variable', 'Geist Mono', monospace",
      theme: activeXtermTheme(get(themeMode)),
      allowProposedApi: true,
    });

    this.unsubscribeTheme = themeMode.subscribe(this.applyXtermTheme);
    this.prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    this.prefersDark.addEventListener("change", this.applyXtermTheme);

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
    // After the fit addon exists — the first emission has to be able to refit.
    this.unsubscribeFontSize = terminalFontSize.subscribe(this.applyFontSize);
    this.registerKeyHandler();
    this.registerOscHandlers();
    this.registerReadinessHandler();
    this.setupResizeObserver(opts.container);
    this.spawnPty(opts.onPtyReady);
    this.setupEnterRefresh();
    if (this._visible) this.startPolling();
  }

  private registerKeyHandler() {
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      // Pass Mission Control's global chords through to the window-level
      // handler — returning false prevents xterm from consuming the key so it
      // bubbles up to App.svelte's <svelte:window onkeydown>.  We must NOT
      // call handleGlobalKeydown here because the window handler already does,
      // which would fire every action twice.
      const mod = e.metaKey || e.ctrlKey;
      // ⌘N / ⌘K / ⌘, — new session, jump palette, settings
      if (mod && !e.shiftKey && ["n", "k", ","].includes(e.key.toLowerCase())) return false;
      // ⌘\ (macOS) and Ctrl+Shift+\ (Windows/Linux) — activity rail
      if (mod && e.key === "\\") return false;
      // Escape is absent by design: the Claude Code TUI owns it while the
      // terminal has focus.
      return true;
    });
  }

  private checkOscReadiness() {
    const tab = get(tabs).find(t => t.id === this.tabId);
    if (tab?.commandWrittenAt && !tab.ready) {
      // 300ms gate: shell preexec hooks fire within ~50ms of command entry;
      // Claude Code's title arrives 500ms+ later. This cleanly separates them.
      if (Date.now() - tab.commandWrittenAt > 300) {
        setTabReady(this.tabId);
      }
    }
  }

  private registerOscHandlers() {
    // OSC 0 & 2: tab title — also triggers readiness after the command gate
    this.terminal.parser.registerOscHandler(0, (data) => {
      setTabTitle(this.tabId, data);
      this.checkOscReadiness();
      updateSessionLabelByTabId(this.tabId, data);
      return true;
    });
    this.terminal.parser.registerOscHandler(2, (data) => {
      setTabTitle(this.tabId, data);
      this.checkOscReadiness();
      updateSessionLabelByTabId(this.tabId, data);
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

  /**
   * Detect when a TUI app (Claude Code) activates the alternate screen buffer
   * via CSI ? 1049 h. This is a deterministic signal that the TUI has started,
   * unlike OSC title sequences which shells also emit.
   */
  private registerReadinessHandler() {
    this.terminal.parser.registerCsiHandler({ final: "h", prefix: "?" }, (params) => {
      if (params.includes(1049)) {
        const tab = get(tabs).find(t => t.id === this.tabId);
        if (tab?.ready === false) {
          setTabReady(this.tabId);
        }
      }
      return false; // don't consume — let xterm process the sequence normally
    });
  }

  /** Re-fit the terminal and sync PTY dimensions. Call after layout changes. */
  fitTerminal() {
    // Double rAF: first lets the browser recalculate layout after CSS class
    // changes (hidden → visible), second ensures paint has completed before
    // we measure the container and fit xterm to it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
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
    log.info("terminal", `spawnPty tab=${this.tabId} cwd=${this.initialCwd ?? "default"}`);
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
      log.info("terminal", `spawnPty success: ptyId=${this.ptyId}`);
      onPtyReady(this.ptyId);
      // Seed cwd from the spawn arg so the diff panel populates without
      // waiting for OSC 7 (not all shells emit it). OSC 7 will still
      // overwrite this when the user `cd`s.
      if (this.initialCwd && !this.currentCwd) {
        this.currentCwd = this.initialCwd;
        this.scheduleRefresh(this.initialCwd);
      }
    } catch (e) {
      log.error("terminal", `spawnPty failed for tab=${this.tabId}`, e);
      showToast("Failed to spawn terminal", { body: String(e) });
      return;
    }

    this.terminal.onData((data) => {
      if (this.ptyId !== null) {
        ptyWrite(this.ptyId, data);
      }
      setTabNeedsInput(this.tabId, false);
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

  private lastPanelVersion = -1;
  private lastPanelDiffRaw: string | null = null;

  /** Cheap identity check: compare version + diff raw string instead of full JSON. */
  private panelChanged(data: PanelData | null): boolean {
    if (!data) return this.lastPanelVersion !== -1;
    if (data.version !== this.lastPanelVersion) return true;
    return (data.diff?.raw ?? null) !== this.lastPanelDiffRaw;
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

        if (this.panelChanged(data)) {
          this.updatePanelFingerprint(data);
          panelData.set(data);
        }
      } catch (e) {
        log.error("terminal", `panel refresh failed for tab=${this.tabId}`, e);
        showToast("Panel refresh failed", { body: String(e) });
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
      this.fitAddon.fit();
      this.terminal.focus();
      if (this.ptyId !== null) {
        ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
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
        this.startPolling();
      });
    });
  }

  destroy() {
    log.info("terminal", `destroy tab=${this.tabId} ptyId=${this.ptyId}`);
    this.resizeObserver?.disconnect();
    this.unsubscribeTheme?.();
    this.unsubscribeFontSize?.();
    this.prefersDark?.removeEventListener("change", this.applyXtermTheme);
    this.stopPolling();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.ptyId !== null) {
      ptyKill(this.ptyId, this.tabId);
    }
    this.terminal?.dispose();
  }
}
