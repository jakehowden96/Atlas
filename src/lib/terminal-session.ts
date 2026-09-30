import { Terminal, type IDecoration, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getPanelData, openUrl, ptyKill, ptyResize, ptySpawn, ptyWrite, refreshPanel } from "./ipc";
import {
  activeTabId,
  setPermissionPromptVisible,
  setTabNeedsInput,
  setTabReady,
  tabs,
} from "./stores/terminal";
import { panelData } from "./stores/panel";
import { keymap, terminalFontSize } from "./stores/settings";
import { matchesAnyBinding } from "./keymap";
import type { PanelData } from "../types/panel";
import { updateSessionLabelByTabId } from "./stores/workspace";
import { get } from "svelte/store";
import { showToast } from "./stores/toast";
import { activeBlockTints, activeXtermTheme, themeMode } from "./theme";
import { classifyRows, detectPermissionPrompt, screenPreview, type RowBlock } from "./overview";
import { log } from "./logger";

export interface TerminalSessionOptions {
  tabId: string;
  container: HTMLDivElement;
  visible: boolean;
  onPtyReady: (ptyId: number) => void;
  cwd?: string;
  /** The PTY could not be spawned; the tab has nothing to wait on. */
  onSpawnError: (message: string) => void;
}

/** How long a terminal waits for its container to be laid out before spawning
 *  the PTY anyway. Long enough to cover a view switch, short enough that a tab
 *  nobody opens still gets a shell. */
const SPAWN_SIZE_TIMEOUT_MS = 1000;

/** How long a parked (off-screen) terminal waits after its last resize before
 *  refitting, so a window drag reflows it once rather than once per frame. */
const HIDDEN_REFIT_DEBOUNCE_MS = 150;

/**
 * The working directory an OSC 7 report names, or `null` if it names none.
 *
 * Shells send `file://host/path`; the path is percent-decoded, and on Windows
 * the drive letter arrives as `/C:/Users/x`, whose leading slash would make
 * the path non-absolute to the backend, so it is dropped. Anything that is
 * not a `file:` URL is taken as a raw path already — `new URL("C:\\x")` would
 * otherwise parse as scheme `c:` and yield `\x`.
 */
export function parseOsc7(data: string): string | null {
  const raw = data.trim();
  if (raw === "") return null;
  if (!/^file:\/\//i.test(raw)) return raw;
  try {
    const path = decodeURIComponent(new URL(raw).pathname);
    return (/^\/[A-Za-z]:(\/|$)/.test(path) ? path.slice(1) : path) || null;
  } catch {
    return null;
  }
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
  private onSpawnError: (message: string) => void;
  /** Set by `destroy()`. Every callback that can fire later — a pending spawn,
   *  PTY output, timers — checks it before touching the disposed xterm. */
  private destroyed = false;
  private ptyWriteFailureShown = false;
  private lastTitle = "";
  private panelRefreshFailing = false;
  private hiddenRefitTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Copy-on-select, the way Claude Code's own TUI copies what you highlight.
      A TUI that leaves the mouse to the terminal — OMP, a plain shell — gets
      xterm's native selection instead, which copies nothing by itself. Read on
      the next tick: xterm finishes the gesture in its own document-level
      mouseup, which fires after this one bubbles through the container. */
  private copySelection = () => {
    setTimeout(() => {
      if (this.destroyed || !this.terminal.hasSelection()) return;
      writeText(this.terminal.getSelection()).catch((e) =>
        log.warn("terminal", `copy-on-select failed: ${e}`),
      );
    }, 0);
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
      ptyResize(this.ptyId, this.terminal.cols, this.terminal.rows).catch((e) =>
        log.warn("terminal", `ptyResize failed for tab=${this.tabId}: ${e}`),
      );
    }
  }

  constructor(opts: TerminalSessionOptions) {
    this.tabId = opts.tabId;
    this.container = opts.container;
    this._visible = opts.visible;
    this.initialCwd = opts.cwd;
    this.onSpawnError = opts.onSpawnError;

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
    this.terminal.loadAddon(new WebLinksAddon((_event, uri) => this.openLink(uri)));

    this.terminal.open(opts.container);

    // Every tab stays mounted for the life of the app, and a webview caps live
    // WebGL contexts (16 in Chromium/WebView2): past that the oldest context is
    // lost and its terminal stops painting. Disposing the addon on loss drops
    // xterm back to its DOM renderer, which is slower but never blank.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      this.terminal.loadAddon(webgl);
    } catch (e) {
      log.warn("terminal", `WebGL renderer unavailable for tab=${this.tabId}: ${e}`);
    }

    // After the fit addon exists — the first emission has to be able to refit.
    this.unsubscribeFontSize = terminalFontSize.subscribe(this.applyFontSize);
    this.registerKeyHandler();
    this.registerOscHandlers();
    this.registerReadinessHandler();
    opts.container.addEventListener("mouseup", this.copySelection);
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
    const onTitle = (data: string) => {
      // Claude Code animates its title, so the same one arrives over and over.
      if (data !== this.lastTitle) {
        this.lastTitle = data;
        updateSessionLabelByTabId(this.tabId, data);
      }
      return true;
    };
    this.terminal.parser.registerOscHandler(0, onTitle);
    this.terminal.parser.registerOscHandler(2, onTitle);

    // OSC 7: CWD reporting — shells emit this when the directory changes
    // Format: file://hostname/path/to/dir
    this.terminal.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data);
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
    this.terminal.parser.registerCsiHandler({ final: "h", prefix: "?" }, (params) => {
      if (params.includes(1049)) {
        const tab = get(tabs).find((t) => t.id === this.tabId);
        if (tab?.ready === false) {
          setTabReady(this.tabId);
        }
      }
      return false; // don't consume — let xterm process the sequence normally
    });
  }

  /**
   * Repaint this terminal's row tints from the finished screen, at most once
   * a frame.
   *
   * xterm parses writes in chunks and `onWriteParsed` fires per chunk, so a
   * TUI repaint would repaint several half-painted screens; coalescing to the
   * next animation frame repaints the finished one. The rows are read from
   * `baseY`, not `viewportY`: a pane the user has scrolled back still tints
   * off the live bottom of the buffer.
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
    for (let i = 0; i < this.terminal.rows; i++) {
      const line = buffer.getLine(buffer.baseY + i);
      plain.push(line?.translateToString(true) ?? "");
    }
    setPermissionPromptVisible(this.tabId, detectPermissionPrompt(plain));
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
   *
   * The tool block's marker is the DOM border on the decoration element
   * itself, the fill is now a neutral surface, and the element is z-index 6
   * (above the renderer canvases, which set no z-index) so a bottom-layer
   * decoration's border still paints.
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
        if (want === "tool") {
          el.style.borderLeftWidth = "2px";
          el.style.borderLeftStyle = "solid";
          el.style.borderLeftColor = "var(--border2)";
          // Sit the rule in the 6px left padding TerminalTab.svelte gives
          // `.xterm`, so it never overlaps column 0's glyph.
          el.style.marginLeft = "-3px";
        }
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
      // Not skipped for a hidden terminal: the registry fills the host to
      // whatever box holds it — the Session pane or the pane-sized parking
      // root — so a backgrounded terminal follows a window resize and comes
      // back on screen already at the right geometry. But dragging the window
      // resizes every host each frame, and each refit reflows the buffer and
      // SIGWINCHes a TUI that then redraws; a parked terminal settles once
      // the burst is over instead.
      if (this._visible) {
        this.refit();
        return;
      }
      clearTimeout(this.hiddenRefitTimer ?? undefined);
      this.hiddenRefitTimer = setTimeout(() => {
        this.hiddenRefitTimer = null;
        if (!this.destroyed) this.refit();
      }, HIDDEN_REFIT_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(container);
  }

  private async spawnPty(onPtyReady: (ptyId: number) => void) {
    log.info("terminal", `spawnPty tab=${this.tabId} cwd=${this.initialCwd ?? "default"}`);
    let ptyId: number;
    try {
      ptyId = await ptySpawn(
        this.terminal.cols,
        this.terminal.rows,
        (data) => {
          // Output can trail the kill; the xterm it would land in is gone.
          if (this.destroyed) return;
          this.terminal.write(data);
        },
        this.initialCwd ?? undefined,
        { ATLAS_SESSION_ID: this.tabId },
      );
    } catch (e) {
      log.error("terminal", `spawnPty failed for tab=${this.tabId}`, e);
      if (this.destroyed) return;
      showToast("Failed to spawn terminal", { body: String(e) });
      this.onSpawnError(String(e));
      return;
    }

    // The tab was closed while the spawn was in flight: nothing owns this
    // shell any more, so it would live until the app quits.
    if (this.destroyed) {
      this.killPty(ptyId);
      return;
    }

    this.ptyId = ptyId;
    log.info("terminal", `spawnPty success: ptyId=${ptyId}`);
    onPtyReady(ptyId);
    // Seed cwd from the spawn arg so the diff panel populates without
    // waiting for OSC 7 (not all shells emit it). OSC 7 will still
    // overwrite this when the user `cd`s.
    if (this.initialCwd && !this.currentCwd) {
      this.currentCwd = this.initialCwd;
      this.scheduleRefresh(this.initialCwd);
    }

    this.terminal.onData((data) => {
      this.writeToPty(data);
      setTabNeedsInput(this.tabId, false);
    });
  }

  /** Send keystrokes to the shell. A dead PTY rejects every write, so the
   *  first failure is toasted and the rest only logged. */
  private writeToPty(data: string) {
    if (this.ptyId === null) return;
    ptyWrite(this.ptyId, data).catch((e) => {
      log.warn("terminal", `ptyWrite failed for tab=${this.tabId}: ${e}`);
      if (this.ptyWriteFailureShown) return;
      this.ptyWriteFailureShown = true;
      showToast("Terminal is no longer running", { body: String(e) });
    });
  }

  /** A link clicked in the terminal goes through `open_url`, which only opens
   *  https URLs, rather than the addon's default `window.open`. Anything it
   *  refuses (`http://localhost:…`, say) is reported instead of silently doing
   *  nothing. */
  private openLink(uri: string) {
    openUrl(uri).catch((e) => {
      log.warn("terminal", `open_url refused ${uri}: ${e}`);
      showToast("Could not open the link", { type: "info", body: String(e) });
    });
  }

  private setupEnterRefresh() {
    // Refresh panel after Enter key — catches cases where OSC 7 isn't emitted
    this.terminal.onData((data) => {
      if (data === "\r" && this.currentCwd) {
        setTimeout(() => {
          if (!this.destroyed && this.currentCwd) this.scheduleRefresh(this.currentCwd);
        }, 1000);
      }
    });
  }

  private lastPanelVersion = -1;
  private lastPanelDiff: string | null = null;

  /** Cheap identity check: version plus the backend's diff fingerprint. */
  private panelChanged(data: PanelData | null): boolean {
    if (!data) return this.lastPanelVersion !== -1;
    if (data.version !== this.lastPanelVersion) return true;
    return (data.diff?.fingerprint ?? null) !== this.lastPanelDiff;
  }

  private updatePanelFingerprint(data: PanelData | null) {
    this.lastPanelVersion = data?.version ?? -1;
    this.lastPanelDiff = data?.diff?.fingerprint ?? null;
  }

  private scheduleRefresh(cwd: string) {
    clearTimeout(this.refreshTimer ?? undefined);
    this.refreshTimer = setTimeout(async () => {
      try {
        const data = await refreshPanel(this.tabId, cwd);
        this.panelRefreshFailing = false;
        if (get(activeTabId) !== this.tabId) return;

        if (this.panelChanged(data)) {
          this.updatePanelFingerprint(data);
          panelData.set(data);
        }
      } catch (e) {
        // Every trigger here is automatic — the 30s poll, Enter, OSC 7 — so a
        // vanished cwd would toast once per session per poll. Log the first
        // failure of a streak and stay quiet until a refresh succeeds again.
        if (!this.panelRefreshFailing) {
          this.panelRefreshFailing = true;
          log.warn("terminal", `panel refresh failed for tab=${this.tabId}: ${e}`);
        }
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
          getPanelData(this.tabId)
            .then((cached) => {
              if (get(activeTabId) !== this.tabId) return;
              if (this.panelChanged(cached)) {
                this.updatePanelFingerprint(cached);
                panelData.set(cached);
              }
            })
            .catch((e) => {
              log.warn("terminal", `getPanelData failed for tab=${this.tabId}: ${e}`);
            });
          this.scheduleRefresh(this.currentCwd);
        } else {
          panelData.set(null);
        }
      });
    });
  }

  destroy() {
    log.info("terminal", `destroy tab=${this.tabId} ptyId=${this.ptyId}`);
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    clearTimeout(this.spawnFallback ?? undefined);
    if (this.screenFrame !== null) cancelAnimationFrame(this.screenFrame);
    this.tints = [];
    this.unsubscribeTheme?.();
    this.unsubscribeFontSize?.();
    this.prefersDark?.removeEventListener("change", this.applyXtermTheme);
    this.container.removeEventListener("mouseup", this.copySelection);
    this.stopPolling();
    clearTimeout(this.refreshTimer ?? undefined);
    clearTimeout(this.hiddenRefitTimer ?? undefined);
    if (this.ptyId !== null) this.killPty(this.ptyId);
    this.terminal?.dispose();
  }

  private killPty(ptyId: number) {
    ptyKill(ptyId, this.tabId).catch((e) =>
      log.warn("terminal", `ptyKill failed for tab=${this.tabId}: ${e}`),
    );
  }
}
