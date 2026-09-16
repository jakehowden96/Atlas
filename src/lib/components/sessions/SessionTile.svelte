<script lang="ts">
  import { formatElapsed, pinKey, previewLines, type SessionTile } from "../../overview";
  import { allowPendingTool, closeSession, denyPendingTool } from "../../session-actions";
  import { togglePinnedSession } from "../../stores/settings";
  import { activeTabId } from "../../stores/terminal";
  import { setTileSlot } from "../../terminal-registry.svelte";
  import { focusedSessionId, showView } from "../../stores/view";

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

  let live = $derived(tile.live);
  let needsYou = $derived(tile.state === "needsYou");

  /**
   * The card's terminal slot: the registry moves the tab's real xterm host
   * into this element whenever it isn't the one Session view is showing
   * (`terminal-registry.svelte.ts` `placeTerminals`). The host fills the slot
   * edge to edge and refits to it, so the terminal renders at this tile's own
   * size rather than the Session pane's — see the note on `.terminal-slot`
   * below.
   *
   * `tile.terminalTabId` unset means a closed-but-resumable session with no
   * live PTY, and the transcript-tail `preview` below is the fallback for it.
   */
  let terminalSlotEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    const tabId = tile.terminalTabId;
    if (!tabId || !terminalSlotEl) return;
    setTileSlot(tabId, terminalSlotEl);
    return () => setTileSlot(tabId, null);
  });

  /** Blank lines render as a non-breaking space so row height stays stable. */
  let preview = $derived(previewLines(live.lines));
  let elapsed = $derived(formatElapsed(live.startedAt, now));
  /* Claude Code appends to the transcript only as a message completes, so a
     long tool call leaves `preview` frozen for minutes and the tile reads as
     idle when it is anything but. This is the tile's own clock: how long since
     the transcript last grew. Shown only while the session is running, where
     the gap means "still working" rather than "finished". */
  let working = $derived(tile.state === "running");
  let sinceLine = $derived(formatElapsed(live.lastActivity, now));

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
  title="{tile.label} · {tile.workspaceName}{tile.branch ? ` · ${tile.branch}` : ''} · {elapsed}"
  onclick={open}
  onkeydown={onKeydown}
>
  <!-- Only on hover/focus, over the terminal rather than displacing it — the
       tile is the terminal now, so identity (name, workspace, elapsed) lives
       in the title tooltip instead of a permanent header. -->
  <div class="overlay">
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

  <!-- The live terminal first. It is not gated on `tailing`, because it does
       not come from the transcript — a session with tailing off still shows
       what its terminal is doing. The transcript tail is the fallback for a
       session whose PTY is gone, which is the only case with nothing to read. -->
  {#if tile.terminalTabId}
    <div class="preview live terminal-slot" bind:this={terminalSlotEl}></div>
  {:else if tailing}
    <div class="preview">
      {#each preview as line, i (i)}
        <div class="line">{line.text || " "}</div>
      {/each}
    </div>
  {:else}
    <div class="preview paused">Transcript tailing is off.</div>
  {/if}

  {#if tailing && working}
    <div class="working" title="The transcript only grows as each message completes">
      <span class="working-dot"></span>
      working{sinceLine ? ` · ${sinceLine} since the last line` : ""}
    </div>
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

  /* ── Overlay controls ───────────────────────────────────────────────────
     Floats over the terminal instead of a permanent header — the tile has no
     chrome of its own now, so pin/close only need to exist on hover/focus. */
  .overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    display: flex;
    gap: 2px;
  }

  /* Stays out of the way until the card is hovered, but remains reachable by
     keyboard — focus-visible brings it back regardless of pointer. */
  .pin,
  .close {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--term-bg) 75%, transparent);
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
  /* A bottom-aligned column that clips what does not fit, so the newest line
     sits against the tile's bottom edge and the pane fills with as much
     history as the tile is tall. `previewLines` hands over more than can fit
     on purpose — see the note there. `flex-end` is what makes the overflow
     fall off the top, which is the end a tail should lose. */
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


  /* Holds the real xterm host the registry moves in — see
     `terminal-registry.svelte.ts` `placeTerminals`. The host fills this slot
     at 100% width/height, so the terminal refits (and resizes its PTY) to
     the tile's own box rather than showing a fixed crop of the Session
     pane's. The small left/bottom padding is a gutter that keeps the
     terminal's own left column off the tile's edge. `pointer-events: none`
     keeps the card clickable and its Allow/Deny buttons reachable — the
     terminal underneath must not steal focus, wheel scroll or clicks meant
     for the card. */
  .terminal-slot {
    position: relative;
    padding: 0 0 6px 6px;
    overflow: hidden;
    pointer-events: none;
  }

  .preview.paused {
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  /* Sits below the preview so a frozen preview is never the last word on
     whether anything is happening. */
  .working {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    padding: 4px 14px;
    background: var(--term-bg);
    color: var(--t-step);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .working-dot {
    flex-shrink: 0;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--t-step);
    animation: atlasPulse 1.6s ease-in-out infinite;
  }

  /* `flex-shrink: 0` because the preview is a flex column now: without it the
     rows would compress instead of overflowing off the top. */
  .line {
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
</style>
