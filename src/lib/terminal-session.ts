import { Terminal, type IBufferCell, type IBufferLine, type IDecoration, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, refreshPanel, getPanelData } from "./ipc";
import { setTabTitle, activeTabId, setTabNeedsInput, setTabReady, tabs } from "./stores/terminal";
import { panelData } from "./stores/panel";
import { clearTerminalScreen, setTerminalScreen, type TerminalRow, type TerminalSegment } from "./stores/terminal-screen";
import { keymap, terminalFontSize } from "./stores/settings";
import { matchesAnyBinding } from "./keymap";
import type { PanelData } from "../types/panel";
import { updateSessionLabelByTabId } from "./stores/workspace";
import { get } from "svelte/store";
import { showToast } from "./stores/toast";
import { activeBlockTints, activeXtermTheme, themeMode } from "./theme";
import { classifyRows, screenPreview, type RowBlock } from "./overview";
import { log } from "./logger";

export interface TerminalSessionOptions {
  tabId: string;
  container: HTMLDivElement;
  visible: boolean;
  onPtyReady: (ptyId: number) => void;
  cwd?: string;
  onData?: (data: string) => void;
}

/** How long a terminal waits for its container to be laid out before spawning
 *  the PTY anyway. Long enough to cover a view switch, short enough that a tab
 *  nobody opens still gets a shell. */
const SPAWN_SIZE_TIMEOUT_MS = 1000;

/**
 * Split a buffer line into same-styled runs for the Sessions grid.
 *
 * Only the 16 named ANSI slots are carried through — `fg`/`bg` beyond that
 * (256-colour, true colour) are the TUI reaching for something `theme.ts`
 * has no light/dark pair for, so those cells fall back to the pane's default
 * ink rather than a colour that would not track the app's theme.
 */
function terminalRowStyle(line: IBufferLine, cols: number, cell: IBufferCell): TerminalRow {
  const segments: TerminalSegment[] = [];
  let current: TerminalSegment | null = null;
  for (let x = 0; x < Math.min(line.length, cols); x++) {
    line.getCell(x, cell);
    // The second column of a wide (CJK-width) character: its glyph is
    // already in the cell before it, so this column contributes nothing.
    if (cell.getWidth() === 0) continue;
    const fg = cell.isFgPalette() && cell.getFgColor() < 16 ? cell.getFgColor() : undefined;
    const bg = cell.isBgPalette() && cell.getBgColor() < 16 ? cell.getBgColor() : undefined;
    const bold = !!cell.isBold();
    const dim = !!cell.isDim();
    const italic = !!cell.isItalic();
    const underline = !!cell.isUnderline();
    const strikethrough = !!cell.isStrikethrough();
    const inverse = !!cell.isInverse();
    if (
      current &&
      current.fg === fg &&
      current.bg === bg &&
      !!current.bold === bold &&
      !!current.dim === dim &&
      !!current.italic === italic &&
      !!current.underline === underline &&
      !!current.strikethrough === strikethrough &&
      !!current.inverse === inverse
    ) {
      current.text += cell.getChars() || " ";
      continue;
    }
    current = { text: cell.getChars() || " ", fg, bg, bold, dim, italic, underline, strikethrough, inverse };
    segments.push(current);
  }
  // Trim the trailing whitespace `translateToString(true)` would also drop
  // — cells past where the TUI actually wrote — so a short line does not
  // pad out to the pane's full width. A `bg` fill is kept even when blank:
  // that is Claude Code shading a row (`ESC[40m`), not empty space.
  while (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.bg !== undefined) break;
    const trimmed = last.text.replace(/\s+$/, "");
    if (trimmed === last.text) break;
    if (trimmed === "") {
      segments.pop();
      continue;
    }
    segments[segments.length - 1] = { ...last, text: trimmed };
    break;
  }
  return segments;
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
  private container: HTMLDivElement;
  /** Held while the container has no size yet; see `spawnWhenSized`. */
  private pendingSpawn: ((ptyId: number) => void) | null = null;
  private spawnFallback: ReturnType<typeof setTimeout> | null = null;
  /** The frame a screen publish is waiting on; see `scheduleScreenPublish`. */
  private screenFrame: number | null = null;
  /** One entry per screen row; see `paintRowTints`. */
  private tints: ({ kind: RowBlock; decoration: IDecoration; marker: IMarker } | null)[] = [];

  /** Re-read the palette for the current mode; also fires on OS-preference
      changes so a terminal on "system" follows the OS without a respawn. */
  private applyXtermTheme = () => {
    this.terminal.options.theme = activeXtermTheme(get(themeMode));
    // The row tints came from the old palette; drop them and repaint from the
    // current buffer so an idle session doesn't keep stale-coloured tints
    // after a theme switch.
    this.clearRowTints();
    this.publishScreen();
  };

  /** Settings' font-size stepper reaches every open terminal through this.
      xterm reflows the buffer on the change, so the pane has to be refit and
      the PTY told its new dimensions. The subscribe fires once immediately
      with the size the terminal was built at, where this is a no-op. */
  private applyFontSize = (size: number) => {
    if (this.terminal.options.fontSize === size) return;
    this.terminal.options.fontSize = size;
    this.refit();
  };

  /**
   * True once the browser has given the container a box.
   *
   * A tab is constructed the moment it enters `$tabs`, into a host the
   * terminal registry (`terminal-registry.svelte.ts`) sizes to fill wherever
   * it currently lives — the Session pane, or otherwise the parking root at
   * the pane's last known size. Either one is `0x0` until the pane has been
   * shown at least once (`App.svelte`'s `.view.hidden` keeps it un-rendered
   * before then), which is usually still true while the Sessions grid is up.
   * `fit()` against a 0x0 element does not fail; it hands xterm a fallback
   * geometry, and a PTY spawned at that size lays the TUI out for a viewport
   * that is not the one on screen.
   */
  private hasSize(): boolean {
    return this.container.clientWidth > 0 && this.container.clientHeight > 0;
  }

  /** Fit to the container and tell the PTY, but never against a 0x0 box. */
  private refit() {
    if (!this.hasSize()) return;
    this.fitAddon.fit();
    if (this.ptyId !== null) {
      ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows);
    }
  }

  constructor(opts: TerminalSessionOptions) {
    this.tabId = opts.tabId;
    this.container = opts.container;
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
      /* Geist Mono is a variable font, and at 400 in the WebGL renderer its
         strokes read lighter than the same face in the surrounding UI. 500 is
         the smallest step that looks deliberate; 600 blooms against --term-bg
         in the light theme. */
      fontWeight: 500,
      fontWeightBold: 700,
      /* theme.ts constrains the 16 named ANSI slots, but Claude Code's TUI also
         leans on dim/faint SGR and 256-colour indices an ITheme cannot name.
         This is xterm's own lever over those paths, and the WebGL renderer
         loaded below honours it. 7 rather than 4.5, to match the floor the
         named slots are held to in `theme.ts`. */
      minimumContrastRatio: 7,
      /* xterm keeps 1000 lines by default, and a Claude Code session passes
         that inside an hour — the earlier transcript was genuinely gone, not
         just unpainted. 10k lines is roughly a full day of one session and
         costs a few MB; every tab stays mounted for the life of the app, so
         this is per-tab memory and not a number to raise casually. */
      scrollback: 10000,
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

    // After the fit addon exists — the first emission has to be able to refit.
    this.unsubscribeFontSize = terminalFontSize.subscribe(this.applyFontSize);
    this.registerKeyHandler();
    this.registerOscHandlers();
    this.registerReadinessHandler();
    this.terminal.onWriteParsed(() => this.scheduleScreenPublish());
    // Cols changing makes a cached tint's `width` stale, and a row shrink can
    // orphan entries past the new row count — simplest is to drop the cache
    // and let the next publish repaint it at the new geometry.
    this.terminal.onResize(() => this.clearRowTints());
    this.setupResizeObserver(opts.container);
    this.spawnWhenSized(opts.onPtyReady);
    this.setupEnterRefresh();
    this.startPolling();
  }

  private registerKeyHandler() {
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      // Bare Escape stays the Claude Code TUI's while the terminal has focus,
      // so it is consumed here whatever the keymap says. The one exception is
      // the platform modifier: mod+Escape is `backToSessions`, and passes
      // through with every other chord below.
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) return true;
      // Pass Mission Control's global chords through to the window-level
      // handler — returning false prevents xterm from consuming the key so it
      // bubbles up to App.svelte's <svelte:window onkeydown>.  We must NOT
      // call handleGlobalKeydown here because the window handler already does,
      // which would fire every action twice.  Reading the live keymap — rather
      // than a hardcoded list — is what keeps a rebound chord working inside a
      // focused terminal.  Alt disqualifies every chord inside `matchBinding`
      // for the reason `keymap.ts` gives: AltGr is Ctrl+Alt, and the terminal
      // must still receive what it types.
      return !matchesAnyBinding(e, get(keymap));
    });
  }

  private registerOscHandlers() {
    // OSC 0 & 2: tab title. Titles do *not* mark the tab ready — only entering
    // the alternate screen buffer does. A title used to count once it arrived
    // more than 300ms after the command was written, on the theory that the
    // shell's own titles land sooner than Claude Code's; a prompt that paints
    // later than that — a slow PSReadLine, oh-my-posh — cleared the overlay
    // while the shell still had `claude --session-id …` on screen, which is
    // the raw command people saw flash before the TUI.
    this.terminal.parser.registerOscHandler(0, (data) => {
      setTabTitle(this.tabId, data);
      updateSessionLabelByTabId(this.tabId, data);
      return true;
    });
    this.terminal.parser.registerOscHandler(2, (data) => {
      setTabTitle(this.tabId, data);
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

  /**
   * Hand the Sessions grid what this terminal is showing, at most once a frame.
   *
   * xterm parses writes in chunks and `onWriteParsed` fires per chunk, so a
   * TUI repaint would publish several half-painted screens; coalescing to the
   * next animation frame publishes the finished one. The rows are read from
   * `baseY`, not `viewportY`: a pane the user has scrolled back still shows
   * its tile the live bottom of the buffer, which is what the tile is for.
   */
  private scheduleScreenPublish() {
    if (this.screenFrame !== null) return;
    this.screenFrame = requestAnimationFrame(() => {
      this.screenFrame = null;
      this.publishScreen();
    });
  }

  private publishScreen() {
    const buffer = this.terminal.buffer.active;
    const plain: string[] = [];
    const styled: TerminalRow[] = [];
    const cell: IBufferCell = this.terminal.buffer.active.getNullCell();
    for (let i = 0; i < this.terminal.rows; i++) {
      const line = buffer.getLine(buffer.baseY + i);
      plain.push(line?.translateToString(true) ?? "");
      styled.push(line ? terminalRowStyle(line, this.terminal.cols, cell) : []);
    }
    setTerminalScreen(this.tabId, plain, styled);
    this.paintRowTints(plain);
  }

  /** Dispose every cached row tint and drop the cache. */
  private clearRowTints() {
    for (const entry of this.tints) {
      if (!entry) continue;
      entry.decoration.dispose();
      entry.marker.dispose();
    }
    this.tints = [];
  }

  /**
   * Tint each screen row's background by the block it belongs to — user
   * input, a tool call and its `⎿` output, or Claude's own prose.
   *
   * One decoration per row, not one per block: the decoration service keys
   * its cell-colour lookup on `marker.line` alone, so `height` only sizes the
   * overlay element and never extends a background past the marker's own
   * row. `layer: "bottom"` plus `backgroundColor` paints behind the glyphs —
   * the same path Claude Code's own `ESC[40m` fills use — so ANSI fg/bold/dim
   * are left untouched, and the decoration API only accepts `#RRGGBB`, hence
   * these tokens are opaque. The cache is keyed by screen row index rather
   * than by marker: in the alt buffer `ybase` is always 0, so a marker's
   * `line` is just its screen row and does not drift as the TUI repaints.
   */
  private paintRowTints(plain: readonly string[]) {
    const buffer = this.terminal.buffer.active;
    const kinds = classifyRows(screenPreview(plain));
    const palette = activeBlockTints(get(themeMode));
    const colour = (k: RowBlock): string | undefined =>
      k === "user" ? palette.user : k === "tool" ? palette.tool : undefined;

    for (let i = 0; i < this.terminal.rows; i++) {
      const kind: RowBlock = kinds[i] ?? null;
      const want: RowBlock = colour(kind) !== undefined ? kind : null;
      const entry = this.tints[i] ?? null;

      if (
        entry &&
        entry.kind === want &&
        !entry.marker.isDisposed &&
        entry.marker.line === buffer.baseY + i
      ) {
        continue;
      }

      if (entry) {
        entry.decoration.dispose();
        entry.marker.dispose();
        this.tints[i] = null;
      }
      if (want === null) continue;

      const marker = this.terminal.registerMarker(i - buffer.cursorY);
      const decoration = this.terminal.registerDecoration({
        marker,
        x: 0,
        width: this.terminal.cols,
        height: 1,
        layer: "bottom",
        backgroundColor: colour(want),
      });
      if (!decoration) {
        marker.dispose();
        this.tints[i] = null;
        continue;
      }
      // Never let a tinted row intercept clicks meant for the TUI beneath it.
      decoration.onRender((el) => {
        el.style.pointerEvents = "none";
      });
      this.tints[i] = { kind: want, decoration, marker };
    }
  }

  /** Re-fit the terminal and sync PTY dimensions. Call after layout changes. */
  fitTerminal() {
    // Double rAF: first lets the browser recalculate layout after CSS class
    // changes (hidden → visible), second ensures paint has completed before
    // we measure the container and fit xterm to it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.hasSize()) return;
        this.refit();
        this.terminal.focus();
      });
    });
  }

  /**
   * Spawn the PTY at the size the pane really is.
   *
   * When the container already has a box — the tab was created while its view
   * was on screen — this is the old immediate path. Otherwise the spawn waits
   * for the first non-zero measurement, which arrives from the resize observer
   * the moment the view stops being `display: none`.
   *
   * The timeout is the floor, not the plan: if the container somehow never
   * gains a size, spawning late at a fallback geometry is what this code did
   * before, and is better than a tab that never gets a PTY at all.
   */
  private spawnWhenSized(onPtyReady: (ptyId: number) => void) {
    if (this.hasSize()) {
      this.fitAddon.fit();
      void this.spawnPty(onPtyReady);
      return;
    }
    this.pendingSpawn = onPtyReady;
    this.spawnFallback = setTimeout(() => {
      log.warn("terminal", `tab=${this.tabId} never got a size; spawning anyway`);
      this.flushPendingSpawn();
    }, SPAWN_SIZE_TIMEOUT_MS);
  }

  /** Start the deferred PTY, at whatever geometry the terminal now has. */
  private flushPendingSpawn() {
    const onPtyReady = this.pendingSpawn;
    if (!onPtyReady) return;
    this.pendingSpawn = null;
    if (this.spawnFallback) {
      clearTimeout(this.spawnFallback);
      this.spawnFallback = null;
    }
    if (this.hasSize()) this.fitAddon.fit();
    void this.spawnPty(onPtyReady);
  }

  private setupResizeObserver(container: HTMLDivElement) {
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.hasSize()) return;
      // The first real measurement is what the deferred spawn was waiting for.
      if (this.pendingSpawn) {
        this.flushPendingSpawn();
        return;
      }
      // Not gated on `_visible`: the registry fills the host to whatever box
      // holds it — the Session pane or the pane-sized parking root — so a
      // backgrounded terminal follows a window resize the same as the visible
      // one does, and comes back on screen already at the right geometry.
      this.refit();
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

  /**
   * Keep this session's diff data current, whether or not its pane is on screen.
   *
   * Not gated on visibility, and this matters: `panel.json` is only written by
   * `refresh_panel`, and the Rust watcher's `panel-update` is what feeds *every*
   * tile's `+/−` badge through `App.svelte`. Polling only the visible terminal
   * meant the other tiles' badges were whatever they last happened to be, and
   * once no terminal counts as visible on the Sessions grid, all of them froze.
   * One `git diff` per session per 30s is what a live grid costs.
   */
  private startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      if (this.currentCwd) this.scheduleRefresh(this.currentCwd);
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

    // The panel poll runs for the life of the session — see `startPolling` —
    // so going off screen only means stopping the refit-and-focus work below.
    if (!visible) return;

    // No-op if already visible (e.g. duplicate effect fire)
    if (wasVisible) return;

    // First rAF: fit terminal and focus (lightweight, runs in the next paint)
    requestAnimationFrame(() => {
      if (!this._visible) return;
      this.refit();
      this.terminal.focus();

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
      });
    });
  }

  destroy() {
    log.info("terminal", `destroy tab=${this.tabId} ptyId=${this.ptyId}`);
    this.resizeObserver?.disconnect();
    if (this.spawnFallback) clearTimeout(this.spawnFallback);
    if (this.screenFrame !== null) cancelAnimationFrame(this.screenFrame);
    clearTerminalScreen(this.tabId);
    this.tints = [];
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
