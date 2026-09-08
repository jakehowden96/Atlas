<script lang="ts">
  import type { PlanEntry } from "../../../types/files";
  import { planWorkspace } from "../../files";
  import type { SessionTile } from "../../overview";
  import { formatElapsed } from "../../overview";
  import {
    formatTokens,
    planCounts,
    planRowState,
    subagentMeta,
    type TouchedFile,
  } from "../../session-view";
  import { fileWs, loadPlans, openFile, plans } from "../../stores/files";
  import { diffOpen, showView } from "../../stores/view";
  import { visibleWorkspaces } from "../../stores/workspace";
  import { closeWith } from "../ui/Modal.svelte";

  interface Props {
    /** Bound to `railOpen`. The rail unmounts itself once the exit run ends. */
    open: boolean;
    /** The focused session, or null before its first `session-update`. */
    tile: SessionTile | null;
    /** `Date.now()`, ticked once a second by the view, for the elapsed clocks. */
    now: number;
    /** Rows for "Files touched", already reduced from the git diff. */
    files: TouchedFile[];
  }

  let { open, tile, now, files }: Props = $props();

  const EXIT_MS = 200;

  // Same delayed-unmount shape as Modal: `visible` lags `open` so the slide-out
  // keyframes finish painting before the node leaves the DOM.
  let visible = $state(false);
  let closing = $state(false);

  $effect(() => {
    if (open) {
      visible = true;
      closing = false;
    } else if (visible && !closing) {
      closing = true;
      closeWith(() => {
        visible = false;
        closing = false;
      }, EXIT_MS);
    }
  });

  // Plan files are read by the Files screen and the ⌘K palette; whichever gets
  // there first fills the store, and on a session-first visit that is the rail.
  $effect(() => {
    if (open && $plans.length === 0) void loadPlans();
  });

  /**
   * The plan file this session's workspace owns, newest first, or null when
   * Claude has never written one for it — which is what disables "Open →".
   *
   * A plan is named after a slugified cwd, not a session, so a workspace's
   * sessions all share its plans; the most recent one is the live plan.
   */
  let planFile = $derived.by<PlanEntry | null>(() => {
    const ws = tile?.workspacePath;
    if (!ws) return null;
    let best: PlanEntry | null = null;
    for (const entry of $plans) {
      if (planWorkspace(entry, $visibleWorkspaces) !== ws) continue;
      if (!best || (entry.modified ?? "") > (best.modified ?? "")) best = entry;
    }
    return best;
  });

  function openPlan() {
    if (!planFile || !tile) return;
    fileWs.set(tile.workspacePath);
    openFile("plans", planFile.path);
    showView("files");
  }

  let live = $derived(tile?.live ?? null);
  let plan = $derived(planCounts(live?.plan ?? []));
  let subagents = $derived(live?.subagents ?? []);
  let contextPct = $derived(Math.min(100, Math.round((live?.contextPct ?? 0) * 100)));
</script>

{#if visible && live}
  <aside class="rail" class:closing>
    <section>
      <div class="heading">
        <span>Plan</span>
        <span class="heading-end">
          <span class="count">{plan.done}/{plan.total}</span>
          <button type="button" class="review" disabled={!planFile} onclick={openPlan}>
            Open →
          </button>
        </span>
      </div>
      <div class="rows">
        {#each live.plan as item, i (i)}
          {@const rowState = planRowState(item)}
          <div class="plan-row">
            <span class="box {rowState}"></span>
            <span class="plan-text {rowState}">{item.text}</span>
          </div>
        {:else}
          <span class="none">No plan yet</span>
        {/each}
      </div>
    </section>

    {#if subagents.length > 0}
      <section>
        <div class="heading"><span>Subagents</span></div>
        <div class="rows">
          {#each subagents as agent, i (i)}
            <div class="agent">
              <div class="agent-task">
                <span class="agent-dot" class:pulsing={!agent.done}></span>
                {agent.task}
              </div>
              <div class="agent-meta">{subagentMeta(agent, now)}</div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <div class="heading"><span>Turn</span></div>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Context</div>
          <div class="stat-value">{contextPct}%</div>
          <div class="ctx-track">
            <span class="ctx-fill" class:hot={contextPct > 75} style="width: {contextPct}%"></span>
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Cost</div>
          <div class="stat-value">${live.costEstimate.toFixed(2)}</div>
          <div class="stat-sub">{formatTokens(live.peakContext)} tokens</div>
        </div>
        <div class="stat">
          <div class="stat-label">Elapsed</div>
          <div class="stat-value">{formatElapsed(live.startedAt, now) || "—"}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Tools</div>
          <div class="stat-value">{live.toolCalls}</div>
        </div>
      </div>
    </section>

    <section>
      <div class="heading">
        <span>Files touched</span>
        <button type="button" class="review" onclick={() => diffOpen.set(true)}>Review →</button>
      </div>
      <div class="files">
        {#each files as file (file.path)}
          <div class="file">
            <span class="file-path">{file.path}</span>
            <span class="file-delta">
              <span class="added">+{file.added}</span>
              <span class="removed">−{file.removed}</span>
            </span>
          </div>
        {:else}
          <span class="none">Working tree clean</span>
        {/each}
      </div>
    </section>
  </aside>
{/if}

<style>
  .rail {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 18px;
    width: 300px;
    padding: 16px;
    overflow: auto;
    border-left: 1px solid var(--border);
    background: var(--bg);
    animation: atlasSlideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .rail.closing {
    animation: atlasSlideOut 0.2s ease both;
  }

  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .heading-end {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .count {
    font-family: var(--font-mono);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .none {
    color: var(--muted);
    font-size: 12px;
  }

  /* ── Plan ──────────────────────────────────────────────────────────────── */
  .plan-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
  }

  .box {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    margin-top: 2px;
    border: 1.5px solid var(--border2);
    border-radius: 3px;
  }

  .box.done {
    border-color: var(--accent);
    background: var(--accent);
  }

  .box.current {
    border-color: var(--warn);
  }

  .plan-text.done {
    color: var(--muted);
    text-decoration: line-through;
  }

  .plan-text.current {
    font-weight: 500;
  }

  /* ── Subagents ─────────────────────────────────────────────────────────── */
  .agent {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
  }

  .agent-task {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .agent-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .agent-dot.pulsing {
    animation: atlasPulse 1.6s ease-in-out infinite;
  }

  .agent-meta {
    margin-top: 3px;
    padding-left: 12px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  /* ── Turn ──────────────────────────────────────────────────────────────── */
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .stat {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
  }

  .stat-label {
    color: var(--muted);
    font-size: 11px;
  }

  .stat-value {
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 500;
  }

  .stat-sub {
    margin-top: 6px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .ctx-track {
    height: 3px;
    margin-top: 6px;
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

  /* ── Files touched ─────────────────────────────────────────────────────── */
  .review {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    cursor: pointer;
  }

  /* No plan file has been written for this workspace yet. */
  .review:disabled {
    color: var(--muted);
    cursor: default;
  }

  .files {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--term-text);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .file {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .file-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-delta {
    white-space: nowrap;
  }

  .added {
    color: var(--accent);
  }

  .removed {
    color: var(--danger);
  }
</style>
