<script lang="ts">
  import type { SessionState } from "../../../types/session";
  import { formatTokens } from "../../format";
  import { formatElapsed, pinKey, previewLines, type SessionTile, screenPreview } from "../../overview";
  import { allowPendingTool, closeSession, denyPendingTool } from "../../session-actions";
  import { togglePinnedSession } from "../../stores/settings";
  import { activeTabId } from "../../stores/terminal";
  import { terminalScreens, type TerminalRow } from "../../stores/terminal-screen";
  import { focusedSessionId, showView } from "../../stores/view";
  import { activeXtermTheme, themeMode } from "../../theme";
  import StatePill, { type PillState } from "../ui/StatePill.svelte";

  const ANSI_NAMES = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow",
    "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
  ] as const;

  /** Reactive so a mid-session theme switch re-colours the preview too. */
  let palette = $derived(activeXtermTheme($themeMode));

  function segColor(index: number | undefined): string | undefined {
    return index === undefined ? undefined : palette[ANSI_NAMES[index]];
  }

  interface Props {
    tile: SessionTile;
    /** `Date.now()` ticked once a second by the view, for the elapsed clock. */
    now: number;
    /** Settings › Claude Code › Tail transcripts. Off means a closed session
        with no live PTY has nothing to preview, so its tile says so instead
        of showing a transcript tail. */
    tailing: boolean;
    /** Pinned tiles sort to the top of the Sessions grid. */
    pinned: boolean;
    /** The grid's roving tab stop: only the focused tile is Tab-reachable. */
    focused: boolean;
    /** Draw the focus ring. Separate from `focused` because the CSS pseudo-
        class of the same name cannot be trusted here: Chromium refuses to
        match `:focus-visible` on a scripted `.focus()` once the last real
        input was a click, and a click is how most sessions get opened. The
        grid says when focus is genuinely on this tile instead. */
    focusVisible: boolean;
  }

  let { tile, now, tailing, pinned, focused, focusVisible }: Props = $props();

  const PILL: Record<SessionState, PillState> = {
    running: "running",
    needsYou: "needs",
    idle: "idle",
    error: "error",
  };

  let live = $derived(tile.live);
  let needsYou = $derived(tile.state === "needsYou");

  /**
   * The terminal's screen as text, published by `TerminalSession` after every
   * parsed write (`stores/terminal-screen.ts`). Live through a long tool call,
   * which the transcript never was. `screenPreview` takes the TUI's prompt box
   * and trailing blank rows off the bottom.
   *
   * `tile.terminalTabId` unset means a closed-but-resumable session with no
   * live PTY, and the transcript-tail `preview` below is the fallback for it.
   */
  let screenData = $derived($terminalScreens.get(tile.terminalTabId ?? ""));
  /* `screenPreview` only ever trims rows off the bottom (blank tail, prompt
     box), so its length is how many of the styled rows — same order, same
     colour and weight the TUI painted them with — to keep. */
  let screen: TerminalRow[] = $derived(
    (screenData?.styled ?? []).slice(0, screenPreview(screenData?.plain ?? []).length),
  );

  /** Blank lines render as a non-breaking space so row height stays stable. */
  let preview = $derived(previewLines(live.lines));
  let elapsed = $derived(formatElapsed(live.startedAt, now));

  function open() {
    focusedSessionId.set(tile.atlasSessionId);
    // The Session view still renders whichever tab is active, so point it at
    // this session's PTY as well as recording the focus.
    if (tile.terminalTabId) activeTabId.set(tile.terminalTabId);
    showView("session");
  }

  /* Only the card's own keys — the pin, close, Deny and Allow buttons sit
     inside it and answer Enter themselves, and the card must not open behind
     them. Arrows are left to bubble; the grid does the moving. */
  function onKeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
      return;
    }
    // Answering a permission prompt is the most valuable keystroke here, so it
    // gets the prompt's own y/n rather than a chord.
    if (!needsYou) return;
    if (e.key === "y" || e.key === "Y") allow(e);
    else if (e.key === "n" || e.key === "N") deny(e);
  }

  // Both stop propagation — the whole card is clickable.
  function allow(e: Event) {
    e.stopPropagation();
    if (tile.terminalTabId) allowPendingTool(tile.terminalTabId);
  }

  function deny(e: Event) {
    e.stopPropagation();
    if (tile.terminalTabId) denyPendingTool(tile.terminalTabId);
  }

  function togglePin(e: MouseEvent) {
    e.stopPropagation();
    void togglePinnedSession(pinKey(tile));
  }

  /* Ends the session but keeps its row, so the conversation stays resumable
     from the New Session modal. Deleting it outright is a Settings action. */
  function close(e: MouseEvent) {
    e.stopPropagation();
    if (tile.atlasSessionId) void closeSession(tile.atlasSessionId);
  }
</script>

<div
  class="tile"
  class:focus-ring={focusVisible}
  class:needs={needsYou}
  role="button"
  tabindex={focused ? 0 : -1}
  onclick={open}
  onkeydown={onKeydown}
>
  <!-- Same fields as the Session view's header, so the two screens read
       alike: which session, which project, which branch, how long. -->
  <div class="head">
    <StatePill state={PILL[tile.state]} />
    <span class="label">{tile.label}</span>
    <span class="ws" title={tile.workspacePath}>
      <span class="ws-dot" style="background: {tile.workspaceColour}"></span>
      <span class="ws-name">{tile.workspaceName}</span>
      {#if tile.branch}<span class="branch">· {tile.branch}</span>{/if}
    </span>
    <span class="elapsed">{elapsed}</span>
    <span class="diff">
      <span class="added">+{tile.diff?.linesAdded ?? 0}</span>
      <span class="removed">−{tile.diff?.linesRemoved ?? 0}</span>
    </span>
    <button
      type="button"
      class="pin"
      class:on={pinned}
      title={pinned ? "Unpin from the top" : "Pin to the top"}
      aria-label="{pinned ? 'Unpin' : 'Pin'} session {tile.label}"
      aria-pressed={pinned}
      onclick={togglePin}
    >
      <span class="material-symbols-outlined">keep</span>
    </button>
    <button
      type="button"
      class="close"
      title="Close session"
      aria-label="Close session {tile.label}"
      onclick={close}
    >
      ✕
    </button>
  </div>

  <!-- The live screen first. It is not gated on `tailing`, because it does
       not come from the transcript — a session with tailing off still shows
       what its terminal is doing. The transcript tail is the fallback for a
       session whose PTY is gone, which is the only case with nothing to read. -->
  {#if tile.terminalTabId}
    <div class="preview">
      {#each screen as row, i (i)}
        <div class="line">
          {#if row.length === 0}
            {" "}
          {:else}
            {#each row as seg, j (j)}
              <span
                class:bold={seg.bold}
                class:dim={seg.dim}
                class:italic={seg.italic}
                class:underline={seg.underline}
                class:strikethrough={seg.strikethrough}
                style:color={seg.inverse ? segColor(seg.bg) : segColor(seg.fg)}
                style:background={seg.inverse ? segColor(seg.fg) : segColor(seg.bg)}
              >{seg.text}</span>
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  {:else if tailing}
    <div class="preview">
      {#each preview as line, i (i)}
        <div class="line">{line.text || " "}</div>
      {/each}
    </div>
  {:else}
    <div class="preview paused">Transcript tailing is off.</div>
  {/if}

  {#if needsYou}
    <div class="permission">
      <span class="wants">
        Wants to run <span class="tool">{live.pendingTool?.name ?? live.lastTool ?? "a tool"}</span>
      </span>
      <button type="button" class="deny" onclick={deny}>Deny <kbd>n</kbd></button>
      <button type="button" class="allow" onclick={allow}>Allow <kbd>y</kbd></button>
    </div>
  {/if}

  <!-- The Session view's footer, field for field. -->
  <div class="foot">
    <span class="last-tool">{live.lastTool ?? "—"}</span>
    <div class="spacer"></div>
    <span>{live.toolCalls} tools</span>
    <span>{formatTokens(live.contextTokens)} ctx</span>
    <span>${live.costEstimate.toFixed(2)}</span>
  </div>
</div>

<style>
  /* Cards use a 1px inset ring instead of a drop shadow. */
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--r-card-lg);
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--border),
      0 1px 2px rgba(0, 0, 0, 0.04);
    text-align: left;
    cursor: pointer;
  }

  .tile.needs {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--warn) 60%, transparent),
      0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .tile:hover {
    box-shadow:
      0 0 0 1px var(--border2),
      0 8px 24px rgba(0, 0, 0, 0.08);
  }

  /* Its own ring rather than the hover lift: with the arrow keys moving focus
     around the grid, where focus is has to read differently from what the
     pointer happens to be over. */
  .tile:focus-visible,
  .tile.focus-ring {
    box-shadow:
      0 0 0 2px var(--accent),
      0 8px 24px rgba(0, 0, 0, 0.08);
    outline: none;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .head {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws {
    display: flex;
    align-items: baseline;
    gap: 6px;
    max-width: 45%;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  /* Out of the muted tier: this is the answer to "which project am I looking
     at", and it was competing with the branch name at the same weight. */
  .ws-name {
    flex-shrink: 0;
    color: var(--text);
    font-weight: 500;
  }

  .branch {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
  }

  .ws-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .elapsed,
  .diff {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .added {
    color: var(--accent);
  }

  .removed {
    margin-left: 4px;
    color: var(--danger);
  }

  /* Stays out of the way until the card is hovered, but remains reachable by
     keyboard — focus-visible brings it back regardless of pointer. */
  .pin,
  .close {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .tile:hover .pin,
  .pin:focus-visible,
  .tile:hover .close,
  .close:focus-visible {
    opacity: 1;
  }

  /* A pin is state, not just an action — it stays lit once set. */
  .pin.on {
    color: var(--accent);
    opacity: 1;
  }

  .pin :global(.material-symbols-outlined) {
    font-size: var(--fs-md);
  }

  .pin.on :global(.material-symbols-outlined) {
    font-variation-settings: "FILL" 1;
  }

  .pin:hover {
    background: var(--surface3);
    color: var(--text);
  }

  .close:hover {
    background: var(--surface3);
    color: var(--danger);
  }

  /* ── Terminal preview ────────────────────────────────────────────────── */
  /* A bottom-aligned column that clips what does not fit, so the newest row
     sits against the tile's footer and the pane fills with as much of the
     screen as the tile is tall. `flex-end` is what makes the overflow fall
     off the top, which is the end a tail should lose. */
  .preview {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    flex: 1;
    min-height: 0;
    padding: 10px 14px;
    overflow: hidden;
    background: var(--term-bg);
    color: var(--term-text);
    font: var(--fs-xs)/1.6 var(--font-mono);
  }

  .preview.paused {
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  /* `flex-shrink: 0` because the preview is a flex column: without it the
     rows would compress instead of overflowing off the top. `pre-wrap`
     rather than an ellipsis because a screen row is as wide as the Session
     pane — clipping it would drop most of every line of prose — and `pre`
     keeps the TUI's own indentation. */
  .line {
    flex-shrink: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .line .bold {
    font-weight: 700;
  }

  .line .dim {
    opacity: 0.65;
  }

  .line .italic {
    font-style: italic;
  }

  .line .underline {
    text-decoration: underline;
  }

  .line .strikethrough {
    text-decoration: line-through;
  }

  .line .underline.strikethrough {
    text-decoration: underline line-through;
  }

  /* ── Permission bar ──────────────────────────────────────────────────── */
  .permission {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border-top: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  }

  .wants {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool {
    color: var(--t-warn);
    font-family: var(--font-mono);
  }

  .deny,
  .allow {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--r-md);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  /* The keys answer the prompt on the focused tile, so the hint belongs on the
     button rather than in a legend somewhere off the card. */
  .deny kbd,
  .allow kbd {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    opacity: 0.65;
  }

  .deny {
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--text);
    font-weight: 500;
  }

  .allow {
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  .foot {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 14px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .last-tool {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }
</style>
