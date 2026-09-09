<script lang="ts">
  import type { LineRole, SessionState } from "../../../types/session";
  import { formatTokens } from "../../format";
  import { formatElapsed, pinKey, planSegments, type SessionTile } from "../../overview";
  import { allowPendingTool, closeSession, denyPendingTool } from "../../session-actions";
  import { togglePinnedSession } from "../../stores/settings";
  import { activeTabId } from "../../stores/terminal";
  import { focusedSessionId, showView } from "../../stores/view";
  import StatePill, { type PillState } from "../ui/StatePill.svelte";

  interface Props {
    tile: SessionTile;
    /** `Date.now()` ticked once a second by the view, for the elapsed clock. */
    now: number;
    /** Settings › Claude Code › Tail transcripts. Off means everything below
        the header is stale, so the tile shows only what other sources feed:
        state, workspace and the diff badge. */
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

  const LINE_COLOUR: Record<LineRole, string> = {
    user: "var(--t-user)",
    step: "var(--t-step)",
    tool: "var(--t-tool)",
    note: "var(--term-text)",
    working: "var(--t-step)",
    alert: "var(--t-warn)",
  };

  let live = $derived(tile.live);
  let needsYou = $derived(tile.state === "needsYou");
  /** Blank lines render as a non-breaking space so row height stays stable. */
  let preview = $derived(live.lines.slice(-6));
  let segments = $derived(planSegments(live.plan));
  /* The bar reads as a proportion, the label as a size — `68k` answers "how
     much room is left" in the unit the model actually meters. */
  let contextPct = $derived(Math.min(100, Math.round(live.contextPct * 100)));
  let contextTokens = $derived(formatTokens(live.peakContext));
  let activeAgents = $derived(live.subagents.some((s) => !s.done));
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

<!-- The workspace colour rides on the card as a band, not only as an 8px dot:
     with several workspaces open the dot was the only thing telling tiles apart
     and it sat inside 11px grey text. The band is reinforcement — the name
     below carries the same information in text, so nothing here depends on
     colour vision. -->
<div
  class="tile"
  style="--ws-colour: {tile.workspaceColour}"
  class:focus-ring={focusVisible}
  class:needs={needsYou}
  role="button"
  tabindex={focused ? 0 : -1}
  onclick={open}
  onkeydown={onKeydown}
>
  <div class="head">
    <StatePill state={PILL[tile.state]} />
    <span class="label">{tile.label}</span>
    <span class="ws" title={tile.workspacePath}>
      <span class="ws-dot" style="background: {tile.workspaceColour}"></span>
      <span class="ws-name">{tile.workspaceName}</span>
      {#if tile.branch}<span class="branch">· {tile.branch}</span>{/if}
    </span>
    <span class="elapsed">{elapsed}</span>
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

  {#if tailing}
    <div class="preview">
      {#each preview as line, i (i)}
        <div class="line" style="color: {LINE_COLOUR[line.role]}">{line.text || " "}</div>
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

  <div class="foot">
    {#if tailing}
      <div class="step-col">
        <span class="step">{live.lastTool ?? "—"}</span>
        <div class="plan">
          {#each segments as done, i (i)}
            <span class="seg" class:done></span>
          {/each}
        </div>
      </div>
    {:else}
      <div class="step-col"><span class="step">—</span></div>
    {/if}

    {#if tailing && live.subagents.length > 0}
      <span class="agents">
        <span class="agent-dot" class:pulsing={activeAgents}></span>
        {live.subagents.length} subagents
      </span>
    {/if}

    {#if tailing}
      <span class="context">
        <span class="ctx-track">
          <span class="ctx-fill" class:hot={contextPct > 75} style="width: {contextPct}%"></span>
        </span>
        {contextTokens}
      </span>

      <span class="cost">${live.costEstimate.toFixed(2)}</span>
    {/if}

    <span class="diff">
      <span class="added">+{tile.diff?.linesAdded ?? 0}</span>
      <span class="removed">−{tile.diff?.linesRemoved ?? 0}</span>
    </span>
  </div>
</div>

<style>
  /* Cards use a 1px inset ring instead of a drop shadow. */
  .tile {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--r-card-lg);
    /* The workspace band. `border-left` rather than a pseudo-element so it
       survives the card's `overflow: hidden` and the focus ring's box-shadow. */
    border-left: 3px solid var(--ws-colour, var(--surface3));
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
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
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
    font-size: 11px;
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

  .elapsed {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
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
    font-size: 11px;
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
    font-size: 15px;
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
  .preview {
    flex: 1;
    min-height: 0;
    padding: 10px 14px;
    overflow: hidden;
    background: var(--term-bg);
    color: var(--term-text);
    font: 11.5px/1.6 var(--font-mono);
  }

  .preview.paused {
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  /* Sits between the preview and the footer so a frozen preview is never the
     last word on whether anything is happening. */
  .working {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    padding: 4px 14px;
    background: var(--term-bg);
    color: var(--t-step);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .working-dot {
    flex-shrink: 0;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--t-step);
    animation: atlasPulse 1.6s ease-in-out infinite;
  }

  .line {
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
    font-size: 12px;
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
    font-size: 11.5px;
    cursor: pointer;
  }

  /* The keys answer the prompt on the focused tile, so the hint belongs on the
     button rather than in a legend somewhere off the card. */
  .deny kbd,
  .allow kbd {
    font-family: var(--font-mono);
    font-size: 10px;
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
    gap: 14px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .step-col {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 4px;
    min-width: 0;
  }

  .step {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan {
    display: flex;
    gap: 2px;
    width: 140px;
  }

  .seg {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--surface3);
  }

  .seg.done {
    background: var(--accent);
  }

  .agents {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 5px;
    color: var(--muted);
    font-size: 11px;
  }

  .agent-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .agent-dot.pulsing {
    animation: atlasPulse 1.6s ease-in-out infinite;
  }

  .context {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 6px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .ctx-track {
    display: block;
    width: 40px;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface3);
  }

  .ctx-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .ctx-fill.hot {
    background: var(--warn);
  }

  .cost,
  .diff {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .added {
    color: var(--accent);
  }

  .removed {
    color: var(--danger);
  }
</style>
