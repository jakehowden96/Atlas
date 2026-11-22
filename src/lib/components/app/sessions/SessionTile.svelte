<script lang="ts">
  import { tooltip } from "../../../ui/tooltip";
  import { untrack } from "svelte";
  import type { SessionState } from "../../../../types/generated/SessionState";
  import { formatTokens } from "../../../format";
  import {
    activity,
    feedItems,
    openQuestion,
    pinKey,
    plainText,
    type SessionTile,
    shortToolName,
    withLiveStatus,
    withLiveTail,
  } from "../../../overview";
  import { allowPendingTool, closeSession, denyPendingTool } from "../../../session-actions";
  import { subagentMeta } from "../../../session-view";
  import { togglePinnedSession } from "../../../stores/settings";
  import { tickets } from "../../../stores/tickets";
  import {
    activeTabId,
    canAnswerPermission,
    liveScreenTails,
    permissionPromptTabs,
    tabs,
  } from "../../../stores/terminal";
  import { focusedSessionId, showView } from "../../../stores/view";
  import { Button } from "$lib/components/ui/button/index.js";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import StatePill, { type PillState } from "../common/StatePill.svelte";
  import StatusMark from "../common/StatusMark.svelte";

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
  let ticketId = $derived($tickets[tile.atlasSessionId]?.link?.id ?? "");

  /** A permission prompt the hook flagged and the terminal screen really
      shows, as opposed to needs-you off a question — a closing one or an
      elicitation dialog, neither of which y/n answers. The flag alone goes stale once the
      user answers in the terminal, so the screen has to agree. */
  let permission = $derived(
    needsYou &&
      live.pendingTool !== null &&
      canAnswerPermission(
        $tabs.find((t) => t.id === tile.terminalTabId),
        $permissionPromptTabs,
      ),
  );
  let question = $derived(openQuestion(live));
  let screenTail = $derived(
    live.state === "running" ? $liveScreenTails.get(tile.terminalTabId ?? "") : undefined,
  );
  let feed = $derived(withLiveTail(feedItems(live.lines, question), screenTail));
  let agents = $derived(live.subagents.filter((a) => !a.done));
  let act = $derived(withLiveStatus(activity(live), live, screenTail?.status ?? null));
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
    const first = found[0];
    const last = found[found.length - 1];
    return first !== undefined && last !== undefined && found.length > 1 ? [first, last] : found;
  });
  let clipped: number[] = $state([]);
  let keptPrompts = $derived(
    clipped.flatMap((i) => {
      const item = feed[i];
      return item?.kind === "you" ? [item] : [];
    }),
  );

  $effect(() => {
    const el = sumEl;
    const watched = promptIndices;
    void feed; // any new row can push a prompt off the top
    if (!el) return;
    const measure = () => {
      const top =
        el.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(el).paddingTop);
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

  /* A click anywhere on the card opens it, except on its own controls (the
     label opens it by itself). */
  function onCardClick(e: MouseEvent) {
    if ((e.target as Element).closest("button")) return;
    open();
  }

  /* Only the card's own keys — the pin, close, Deny and Allow buttons sit
     beside the label and answer Enter themselves, and the card must not open
     behind them. Arrows are left to bubble; the grid does the moving. */
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

  // Both stop propagation — the whole card is clickable. Neither rejects: a
  // failed write is toasted inside `answerPendingTool`.
  function allow(e: Event) {
    e.stopPropagation();
    if (tile.terminalTabId) void allowPendingTool(tile.terminalTabId);
  }

  function deny(e: Event) {
    e.stopPropagation();
    if (tile.terminalTabId) void denyPendingTool(tile.terminalTabId);
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

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
  class="tile"
  class:focus-ring={focusVisible}
  class:needs={needsYou}
  aria-label={tile.label}
  tabindex={focused ? 0 : -1}
  onclick={onCardClick}
  onkeydown={onKeydown}
>
  <!-- Which session, which project, which ticket, how full its context is. -->
  <div class="head">
    <div class="row1">
      <button type="button" class="label" tabindex="-1" onclick={open}>{tile.label}</button>
      <TooltipButton
        icon="keep"
        size="sm"
        label="{pinned ? 'Unpin' : 'Pin'} session {tile.label}"
        aria-pressed={pinned}
        onclick={togglePin}
      />
      <TooltipButton icon="close" size="sm" label="Close session {tile.label}" onclick={close} />
    </div>
    <div class="row2">
      <StatePill state={PILL[tile.state]} />
      <span class="ws" use:tooltip={{ text: tile.workspacePath }}>
        <span class="swatch" style="background: {tile.workspaceColour}"></span>
        <span class="ws-name">{tile.workspaceName}</span>
      </span>
      <span class="meta">
        {#if ticketId}<span class="ticket">{ticketId}</span>{/if}
        <span>{formatTokens(live.contextTokens)} ctx</span>
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

  <!-- The conversation's tail: the transcript's, plus the in-progress rows the
       terminal shows but the transcript hasn't written yet. Prompts, Claude's
       prose and the tools it ran, newest at the bottom. Older rows fall off
       the top as the card runs out of room. -->
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
          {#if i === 0 || feed[i - 1]?.kind === "you"}<span class="lbl">Claude</span>{/if}
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
      <StatusMark state="attention" />
      <span class="wants">
        Wants to run <span class="tool">{shortToolName(live.pendingTool.name)}</span
        >{#if live.pendingTool.inputSummary}{` · ${live.pendingTool.inputSummary}`}{/if}
      </span>
      <Button size="sm" variant="outline" class="ask-deny" onclick={deny}>Deny <Kbd>n</Kbd></Button>
      <Button size="sm" variant="default" class="ask-allow" onclick={allow}>Allow <Kbd>y</Kbd></Button>
    </div>
  {:else if question}
    <div class="ask">
      <StatusMark state="attention" /><span class="wants">{plainText(question)}</span>
      <span class="open-hint"><Kbd>⏎</Kbd> open</span>
    </div>
  {:else if needsYou}
    <div class="ask">
      <StatusMark state="attention" /><span class="wants">Waiting for your input</span>
      <span class="open-hint"><Kbd>⏎</Kbd> open</span>
    </div>
  {/if}

  {#if act && !permission}
    <div class="now" class:done={!act.running}>
      {#if act.running}<i class="spin" aria-hidden="true"></i>{/if}
      <span>{act.text}</span>
    </div>
  {/if}
</article>

<style>
  /* Cards use a 1px inset ring instead of a drop shadow. */
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius-xl);
    background: var(--card);
    box-shadow: 0 0 0 1px var(--border);
    text-align: left;
    cursor: pointer;
  }

  .tile:hover {
    box-shadow: 0 0 0 1px var(--input);
  }

  /* Needs-you draws no ring: the amber action bar (`.ask`) carries it, so the
     ring is free to mean "focused" alone. */

  /* The global ring, also drawn by `focusVisible` (see the prop for why the
     pseudo-class alone is not enough). Inset: the card clips its overflow. */
  .tile:focus-visible,
  .tile.focus-ring {
    outline: var(--focus-width) solid var(--ring);
    outline-offset: -2px;
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
    padding: 0;
    border: none;
    background: none;
    color: var(--foreground);
    font: inherit;
    font-size: var(--text-md);
    font-weight: 600;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .ws {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-2);
    max-width: 40%;
    color: var(--foreground);
    font-size: var(--text-caption);
  }

  .swatch {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-xs);
  }

  .ws-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: inline-flex;
    flex-shrink: 0;
    gap: 10px;
    margin-left: auto;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  .ticket {
    color: var(--foreground);
  }

  /* A pin is state, not just an action — it stays lit once set. */
  .row1 :global([aria-pressed="true"]) {
    color: var(--success);
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
    font-size: var(--text-sm);
    mask-image: linear-gradient(to bottom, transparent, var(--foreground) 20px);
  }

  .kept-prompts {
    display: grid;
    gap: 3px;
    padding: 12px 14px 0;
    font-size: var(--text-sm);
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
    font-size: var(--text-xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .you {
    background: var(--muted);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    color: var(--foreground);
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
    color: var(--muted-foreground);
  }

  .reply.latest {
    -webkit-line-clamp: 6;
    line-clamp: 6;
    color: var(--foreground);
  }

  .step {
    display: flex;
    gap: 8px;
    min-width: 0;
    padding-left: 8px;
    border-left: 2px solid var(--input);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    white-space: nowrap;
  }

  .step-tool {
    flex-shrink: 0;
    color: var(--t-tool);
  }

  .step-arg {
    min-width: 0;
    overflow: hidden;
    color: var(--muted-foreground);
    text-overflow: ellipsis;
  }

  .step.alert {
    overflow: hidden;
    border-left-color: var(--destructive);
    color: var(--destructive);
    text-overflow: ellipsis;
  }

  /* ── Running subagents ───────────────────────────────────────────────── */
  .agents {
    display: grid;
    flex-shrink: 0;
    gap: 4px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: var(--text-caption);
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
    background: var(--success);
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
    color: var(--foreground);
    text-overflow: ellipsis;
  }

  .agent-meta,
  .agent-more {
    flex-shrink: 0;
    color: var(--muted-foreground);
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
    color: var(--muted-foreground);
  }

  .empty strong {
    color: var(--foreground);
    font-weight: var(--font-weight-medium);
  }

  /* ── Callout ─────────────────────────────────────────────────────────── */
  /* Solid full-width action bar. `--card` is the ink: dark on the dark
     theme's amber, white on the light theme's. */
  .ask {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 8px 14px;
    background: var(--warning);
    color: var(--card);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  /* The mark is amber by default, which vanishes on the amber bar: draw it in the ink. */
  .ask :global(.mark) {
    background: currentColor;
  }

  /* On the amber bar the theme's button fills read backwards (design: Deny outlined in
     the ink, Allow filled with it), so both take the bar's own colours. */
  .ask :global(.ask-deny) {
    border-color: currentColor;
    background: transparent;
    color: inherit;
  }

  .ask :global(.ask-allow) {
    background: var(--card);
    color: var(--foreground);
  }

  .ask :global(.ask-deny kbd),
  .ask :global(.ask-allow kbd) {
    border-color: color-mix(in oklab, currentColor 35%, transparent);
    background: transparent;
    color: currentColor;
  }

  .open-hint {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-2);
    font-size: var(--text-caption);
  }

  .wants {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool {
    font-family: var(--font-mono);
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
    font-size: var(--text-caption);
    color: var(--foreground);
  }

  .now span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .now.done {
    color: var(--muted-foreground);
    font-family: var(--font-sans);
  }

  .spin {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border: 2px solid color-mix(in srgb, var(--success) 25%, transparent);
    border-top-color: var(--success);
    border-radius: 50%;
    animation: tileSpin 0.9s linear infinite;
  }

  @keyframes tileSpin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
