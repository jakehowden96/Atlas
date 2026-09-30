<script lang="ts">
  import { untrack } from "svelte";
  import type { SessionState } from "../../../types/session";
  import { formatTokens } from "../../format";
  import {
    activity,
    feedItems,
    formatElapsed,
    openQuestion,
    pinKey,
    plainText,
    type SessionTile,
    shortToolName,
  } from "../../overview";
  import { allowPendingTool, closeSession, denyPendingTool } from "../../session-actions";
  import { subagentMeta } from "../../session-view";
  import { togglePinnedSession } from "../../stores/settings";
  import { activeTabId } from "../../stores/terminal";
  import { focusedSessionId, showView } from "../../stores/view";
  import StatePill, { type PillState } from "../ui/StatePill.svelte";

  interface Props {
    tile: SessionTile;
    /** `Date.now()` ticked once a second by the view, for the elapsed clock. */
    now: number;
    /** Settings › Claude Code › Tail transcripts. Off means a closed session
        with no live PTY has no transcript to read a prompt or reply off, so
        the card says so instead of showing them. */
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
  let elapsed = $derived(formatElapsed(live.startedAt, now));

  /** A permission prompt the hook flagged, as opposed to needs-you off a
      question — a closing one, or an OMP `ask` the backend itself reports as
      `needsYou`, which y/n does not answer. */
  let permission = $derived(needsYou && live.state !== "needsYou" && live.pendingTool !== null);
  let question = $derived(openQuestion(live));
  let feed = $derived(feedItems(live.lines, question));
  let agents = $derived(live.subagents.filter((a) => !a.done));
  let act = $derived(activity(live));
  let emptyMeta = $derived([live.model, tile.workspacePath].filter(Boolean).join(" · "));

  /* The feed is bottom-anchored and clips its oldest rows by the room the card
     has, so on a long turn the prompts are the first thing to go. The first
     prompt says what the session is for and the newest what it is doing now;
     either one, once clipped, is repeated above the feed. Pinning a clipped
     prompt only shrinks the feed, which keeps it clipped, so the measurement
     settles instead of flickering. */
  let sumEl: HTMLDivElement | undefined = $state();
  let promptIndices = $derived.by(() => {
    const found: number[] = [];
    feed.forEach((item, i) => {
      if (item.kind === "you") found.push(i);
    });
    return found.length > 1 ? [found[0], found[found.length - 1]] : found;
  });
  let clipped: number[] = $state([]);
  let keptPrompts = $derived(clipped.map((i) => feed[i]).filter((item) => item?.kind === "you"));

  $effect(() => {
    const el = sumEl;
    const watched = promptIndices;
    void feed; // any new row can push a prompt off the top
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(el).paddingTop);
      const next = watched.filter((i) => {
        const row = el.querySelector(`[data-feed="${i}"]`);
        return row !== null && row.getBoundingClientRect().top < top;
      });
      if (next.join() !== untrack(() => clipped).join()) clipped = next;
    };
    untrack(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

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
    if (!permission) return;
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
    <div class="row1">
      <span class="label">{tile.label}</span>
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
    <div class="row2">
      <StatePill state={PILL[tile.state]} />
      <span class="ws-chip" style="--tc: {tile.workspaceColour}" title={tile.workspacePath}
        >{tile.workspaceName}</span
      >
      {#if tile.branch}<span class="branch">{tile.branch}</span>{/if}
      <span class="elapsed">{elapsed}</span>
      <span class="diff">
        <span class="added">+{tile.diff?.linesAdded ?? 0}</span>
        <span class="removed">−{tile.diff?.linesRemoved ?? 0}</span>
      </span>
    </div>
  </div>

  {#if keptPrompts.length > 0}
    <div class="kept-prompts">
      <span class="lbl">You</span>
      {#each keptPrompts as item, i (i)}
        <div class="you"><span>{item.text}</span></div>
      {/each}
    </div>
  {/if}

  <!-- The conversation's tail from the transcript, in place of a terminal
       preview: prompts, Claude's prose and the tools it ran, newest at the
       bottom. Older rows fall off the top as the card runs out of room. -->
  <div class="sum" bind:this={sumEl}>
    {#if feed.length === 0}
      {#if !tailing}
        <div class="empty">Transcript tailing is off.</div>
      {:else}
        <div class="empty">
          <strong>No messages yet</strong>
          {#if emptyMeta}<span>{emptyMeta}</span>{/if}
        </div>
      {/if}
    {:else}
      {#each feed as item, i (i)}
        {#if item.kind === "you"}
          <div class="blk" data-feed={i}>
            <span class="lbl">You</span>
            <div class="you"><span>{item.text}</span></div>
          </div>
        {:else}
          {#if i === 0 || feed[i - 1].kind === "you"}<span class="lbl">Claude</span>{/if}
          {#if item.kind === "note"}
            <div class="reply" class:latest={i === feed.length - 1}>{item.text}</div>
          {:else if item.kind === "step"}
            <div class="step">
              <span class="step-tool">{item.tool}</span>{#if item.text}<span class="step-arg"
                  >{item.text}</span
                >{/if}
            </div>
          {:else}
            <div class="step alert">{item.text}</div>
          {/if}
        {/if}
      {/each}
    {/if}
  </div>

  {#if agents.length > 0}
    <div class="agents">
      {#each agents.slice(0, 3) as agent, i (i)}
        <div class="agent">
          <span class="agent-dot" aria-hidden="true"></span>
          <span class="agent-task">{agent.task}</span>
          <span class="agent-meta">{subagentMeta(agent, now)}</span>
        </div>
      {/each}
      {#if agents.length > 3}<div class="agent-more">+{agents.length - 3} more</div>{/if}
    </div>
  {/if}

  {#if permission && live.pendingTool}
    <div class="ask permission">
      <span class="wants">
        Wants to run <span class="tool">{shortToolName(live.pendingTool.name)}</span>{#if live.pendingTool.inputSummary} · {live.pendingTool.inputSummary}{/if}
      </span>
      <button type="button" class="deny" onclick={deny}>Deny <kbd>n</kbd></button>
      <button type="button" class="allow" onclick={allow}>Allow <kbd>y</kbd></button>
    </div>
  {:else if question}
    <div class="ask">{plainText(question)}</div>
  {:else if needsYou}
    <div class="ask">Waiting for your input</div>
  {/if}

  {#if act && !permission}
    <div class="now" class:done={!act.running}>
      {#if act.running}<i class="spin" aria-hidden="true"></i>{/if}
      <span>{act.text}</span>
    </div>
  {/if}

  <!-- The Session view's footer, field for field. -->
  <div class="foot">
    <span class="last-tool">{shortToolName(live.pendingTool?.name ?? live.lastTool)}</span>
    <span class="stats"
      >{live.toolCalls} tools · {formatTokens(live.contextTokens)} ctx · ${live.costEstimate.toFixed(
        2,
      )}</span
    >
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

  .tile:hover {
    box-shadow:
      0 0 0 1px var(--border2),
      0 8px 24px rgba(0, 0, 0, 0.08);
  }

  .tile.needs,
  .tile.needs:hover {
    box-shadow:
      0 0 0 1px var(--warn),
      0 1px 2px rgba(0, 0, 0, 0.04);
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
    display: grid;
    gap: 6px;
    padding: 12px 14px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }

  .row1,
  .row2 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-md);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .ws-chip {
    display: inline-block;
    flex-shrink: 0;
    max-width: 40%;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: 20px;
    background: color-mix(in srgb, var(--tc) 34%, transparent);
    border: 1px solid color-mix(in srgb, var(--tc) 55%, transparent);
    color: var(--tc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .elapsed,
  .diff {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
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

  /* ── Card body ───────────────────────────────────────────────────────── */
  /* Bottom-anchored: the newest row sits on the card's floor and older ones
     are clipped off the top once the card is full. Overflow shows through the
     top padding, so the mask fades exactly that band and nothing below it. */
  .sum {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 6px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 20px 14px 14px;
    font-size: var(--fs-sm);
    mask-image: linear-gradient(to bottom, transparent, #000 20px);
  }

  .kept-prompts {
    display: grid;
    gap: 3px;
    padding: 12px 14px 0;
    font-size: var(--fs-sm);
  }

  /* Clamped rows would otherwise shrink to nothing under the column's squeeze. */
  .sum > * {
    flex-shrink: 0;
  }

  .sum > .blk:not(:first-child),
  .sum > .lbl:not(:first-child) {
    margin-top: 6px;
  }

  .blk {
    display: grid;
    gap: 3px;
  }

  .lbl {
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .you {
    background: var(--surface2);
    border-radius: var(--r-md);
    padding: 8px 10px;
    color: var(--text);
  }

  /* The clamp sits on the inner span: clamped on the padded box itself, the
     next line bleeds into the bottom padding. */
  .you span {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .reply {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--muted);
  }

  .reply.latest {
    -webkit-line-clamp: 6;
    line-clamp: 6;
    color: var(--text);
  }

  .step {
    display: flex;
    gap: 8px;
    min-width: 0;
    padding-left: 8px;
    border-left: 2px solid var(--border2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .step-tool {
    flex-shrink: 0;
    color: var(--t-tool);
  }

  .step-arg {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
  }

  .step.alert {
    overflow: hidden;
    border-left-color: var(--danger);
    color: var(--danger);
    text-overflow: ellipsis;
  }

  /* ── Running subagents ───────────────────────────────────────────────── */
  .agents {
    display: grid;
    flex-shrink: 0;
    gap: 4px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-xs);
  }

  .agent {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }

  .agent-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: agentPulse 1.6s ease-in-out infinite;
  }

  @keyframes agentPulse {
    50% {
      opacity: 0.35;
    }
  }

  .agent-task {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
  }

  .agent-meta,
  .agent-more {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    text-align: center;
    color: var(--muted);
  }

  .empty strong {
    color: var(--text);
    font-weight: var(--fw-medium);
  }

  /* ── Callout ─────────────────────────────────────────────────────────── */
  .ask {
    flex-shrink: 0;
    margin: 0 14px 10px;
    border-left: 2px solid var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
    border-radius: 0 var(--r-md) var(--r-md) 0;
    padding: 6px 10px;
    color: var(--text);
  }

  .ask.permission {
    display: flex;
    align-items: center;
    gap: 10px;
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

  /* ── Now line ────────────────────────────────────────────────────────── */
  .now {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    min-width: 0;
    padding: 0 14px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--text);
  }

  .now span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .now.done {
    color: var(--muted);
    font-family: var(--font-ui);
  }

  /* Deliberately not gated on prefers-reduced-motion: this is an activity
     indicator, not decorative motion, and macOS keeps its own spinners turning
     under Reduce Motion. Gated, a running card shows a frozen ring that reads
     as stalled. */
  .spin {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: tileSpin 0.9s linear infinite;
  }

  @keyframes tileSpin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  .foot {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    white-space: nowrap;
    min-width: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .last-tool {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stats {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
