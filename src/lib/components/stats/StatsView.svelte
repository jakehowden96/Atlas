<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { basename } from "../../format";
  import {
    agoLabel,
    daySeries,
    delta,
    deltaLabel,
    deltaTone,
    fmtCost,
    fmtCount,
    fmtDuration,
    fmtF1,
    fmtTokens,
    HEATMAP_DAYS,
    modelColour,
    modelRows,
    modelsForRange,
    peakDay,
    projectRows,
    RANGE_LABELS,
    recentForRange,
    recentWeeks,
    shortDate,
    sortedModels,
    sparkSeries,
    toolRows,
    totalsForRange,
    weekFamilies,
    weekLabel,
    WEEK_COUNT,
    type Range,
  } from "../../stats-derive";
  import { statsLoading, statsSummary } from "../../stores/stats";
  import { openNewSession } from "../../stores/view";
  import { visibleWorkspaces } from "../../stores/workspace";
  import Sparkline from "../ui/Sparkline.svelte";
  import SegmentedControl from "../ui/SegmentedControl.svelte";

  /* Both the summary and its loading flag live in `stores/stats`: the top bar
     needs the same figures while this screen is unmounted, and two independent
     loads would have meant two subscriptions to the same recompute. */
  let summary = $derived($statsSummary);
  let loading = $derived($statsLoading);
  let range = $state<Range>("30d");
  /** The Tools card lists only its top rows until this flips. */
  let toolsExpanded = $state(false);
  /** Ticks so the "Ns ago" indicator stays honest between recomputes. */
  let now = $state(new Date());
  let ticker: ReturnType<typeof setInterval> | null = null;

  const rangeOptions = [
    { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" },
    { id: "all", label: "All time" },
  ];

  /** Tool rows shown collapsed; the rest arrive on "Show all". */
  const TOOLS_COLLAPSED = 8;

  onMount(() => {
    ticker = setInterval(() => (now = new Date()), 5000);
  });

  onDestroy(() => {
    if (ticker) clearInterval(ticker);
  });

  // ── Range-driven slices ─────────────────────────────────────────────────
  let totals = $derived(summary ? totalsForRange(summary, range) : null);
  let models = $derived(summary ? sortedModels(modelsForRange(summary, range)) : []);
  let rows = $derived(modelRows(models));
  let tools = $derived(summary ? toolRows(summary, range) : []);
  let visibleTools = $derived(toolsExpanded ? tools : tools.slice(0, TOOLS_COLLAPSED));
  let projects = $derived(summary ? projectRows(summary, range) : []);
  let recent = $derived(summary ? recentForRange(summary, range, now) : []);
  let spark = $derived(summary ? sparkSeries(summary.byDay ?? {}, range, now) : []);

  // Fixed windows by design: the heatmap is always 30 days, the bar chart 8 weeks.
  let heatmap = $derived(summary ? daySeries(summary.byDay ?? {}, now, HEATMAP_DAYS) : []);
  let heatmapPeak = $derived(peakDay(heatmap));
  let heatmapMax = $derived(Math.max(1, ...heatmap.map((d) => d.stats.sessions)));
  let weeks = $derived(summary ? recentWeeks(summary.byWeek ?? {}, WEEK_COUNT) : []);
  let weekMax = $derived(Math.max(1, ...weeks.map(([, w]) => w.sessions)));
  let subagentMax = $derived(
    Math.max(1, ...weeks.map(([, w]) => sum(Object.values(w.byModelSubagents ?? {})))),
  );
  let families = $derived(weekFamilies(weeks));
  let toolMax = $derived(Math.max(1, ...tools.map((t) => t.count)));
  let projectMax = $derived(Math.max(1, ...projects.map(([, p]) => p.sessions)));

  function sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0);
  }

  function per(value: number, sessions: number): number {
    return sessions > 0 ? value / sessions : 0;
  }

  /** Six KPI cards: value, delta against the previous window, sparkline, caption. */
  let kpis = $derived.by(() => {
    if (!totals) return [];
    const cur = totals.current;
    const prev = totals.previous;
    const s = Math.max(1, cur.sessions);
    const days = Math.max(1, spark.length);
    return [
      {
        label: "Sessions",
        value: fmtCount(cur.sessions),
        delta: delta(cur.sessions, prev?.sessions ?? null),
        sub: `${fmtF1(cur.sessions / days)} / day`,
        values: spark.map((d) => d.stats.sessions),
      },
      {
        label: "Messages sent",
        value: fmtCount(cur.userMessages),
        delta: delta(cur.userMessages, prev?.userMessages ?? null),
        sub: `${fmtF1(per(cur.userMessages, s))} / session`,
        values: spark.map((d) => d.stats.userMessages),
      },
      {
        label: "Output tokens",
        value: fmtTokens(cur.outputTokens),
        delta: delta(cur.outputTokens, prev?.outputTokens ?? null),
        sub: `${fmtTokens(per(cur.outputTokens, s))} / session`,
        values: spark.map((d) => d.stats.outputTokens),
      },
      {
        label: "Est. cost",
        value: fmtCost(cur.cost),
        delta: delta(cur.cost, prev?.cost ?? null),
        sub: `${fmtCost(per(cur.cost, s))} / session`,
        values: spark.map((d) => d.stats.cost),
      },
      {
        label: "Peak context",
        value: fmtTokens(cur.peakContext),
        delta: delta(cur.peakContext, prev?.peakContext ?? null),
        sub: "largest single session",
        values: spark.map((d) => d.stats.peakContext),
      },
      {
        label: "Subagents",
        value: fmtCount(cur.subagents),
        delta: delta(cur.subagents, prev?.subagents ?? null),
        sub: `${fmtF1(per(cur.subagents, s))} / session`,
        values: spark.map((d) => d.stats.subagents),
      },
    ];
  });

  /** Workspace colour from the workspace store, matched on the session's cwd. */
  function workspaceColour(path: string | null): string {
    if (!path) return "var(--surface3)";
    const key = normalise(path);
    const match = $visibleWorkspaces.find((w) => normalise(w.path) === key);
    return match?.color ?? "var(--surface3)";
  }

  function normalise(path: string): string {
    return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  }

  /** Heatmap intensity: zero days sit at --surface3, busier days mix in --accent. */
  function cellStyle(sessions: number): string {
    if (sessions === 0) return "background: var(--surface3)";
    const pct = Math.min(95, 25 + sessions * 8);
    return `background: color-mix(in srgb, var(--accent) ${pct}%, var(--surface3))`;
  }

  function errorTone(pct: number): "danger" | "warn" | "muted" {
    if (pct >= 5) return "danger";
    if (pct >= 2) return "warn";
    return "muted";
  }

  function sessionTitle(title: string | null, id: string): string {
    return title && title.trim().length > 0 ? title : id.slice(0, 8);
  }
</script>

<div class="stats-view">
  <!-- Range bar — drives every panel below except the two fixed-window charts. -->
  <div class="range-bar">
    <SegmentedControl
      options={rangeOptions}
      value={range}
      onChange={(id) => (range = id as Range)}
      size="sm"
    />
    <span class="note">
      {range === "all"
        ? "All time has no previous period to compare with."
        : `Deltas compare with the previous ${RANGE_LABELS[range]}.`}
    </span>
    <div class="spacer"></div>
    <span class="live">
      ~/.claude transcripts · live · {summary ? agoLabel(summary.generatedAt, now) : "…"}
    </span>
  </div>

  {#if loading && !summary}
    <div class="empty-page">Scanning transcripts…</div>
  {:else if !summary}
    <div class="empty-page">No transcripts found under ~/.claude/projects.</div>
  {:else}
    <!-- KPI strip -->
    <div class="kpis">
      {#each kpis as kpi (kpi.label)}
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-label">{kpi.label}</span>
            <span class="kpi-delta {deltaTone(kpi.delta)}">{deltaLabel(kpi.delta)}</span>
          </div>
          <div class="kpi-body">
            <span class="kpi-value">{kpi.value}</span>
            <Sparkline values={kpi.values} />
          </div>
          <span class="kpi-sub">{kpi.sub}</span>
        </div>
      {/each}
    </div>

    <!-- Row 2 — by model · sessions by week · tools -->
    <div class="row row2">
      <section class="card">
        <div class="model-head" style="--cols: {models.length}">
          <span class="card-title">By model</span>
          {#each models as [family] (family)}
            <span class="model-col">
              <span class="swatch" style="background: {modelColour(family)}"></span>{family}
            </span>
          {/each}
        </div>
        {#if models.length === 0}
          <p class="empty-card">No sessions in this window.</p>
        {:else}
          {#each rows as row (row.label)}
            <div class="model-row" style="--cols: {models.length}">
              <span class="model-label">{row.label}</span>
              {#each row.values as value, i (models[i][0])}
                <span class="num">{value}</span>
              {/each}
            </div>
          {/each}
          <p class="footnote">
            Model follows task difficulty — usage facts, not a controlled comparison.
          </p>
        {/if}
      </section>

      <section class="card weeks-card">
        <div class="card-head">
          <span class="card-title">Sessions by week</span>
          <span class="card-sub">stacked by model · dot = subagents · last {WEEK_COUNT} weeks</span>
        </div>
        {#if weeks.length === 0}
          <p class="empty-card">No sessions yet.</p>
        {:else}
          <div class="weeks">
            {#each weeks as [key, week] (key)}
              {@const agents = sum(Object.values(week.byModelSubagents ?? {}))}
              <div class="week">
                <span class="week-total">{week.sessions}</span>
                <div
                  class="stack"
                  style="height: {(week.sessions / weekMax) * 100}%"
                  title="{week.sessions} sessions"
                >
                  {#each families as family (family)}
                    {@const n = week.byModel?.[family] ?? 0}
                    {#if n > 0}
                      <span
                        class="seg"
                        style="height: {(n / week.sessions) * 100}%; background: {modelColour(
                          family,
                        )}"
                        title="{family}: {n}"
                      ></span>
                    {/if}
                  {/each}
                </div>
                <span
                  class="agent-dot"
                  style="width: {4 + (agents / subagentMax) * 6}px; height: {4 +
                    (agents / subagentMax) * 6}px; opacity: {agents > 0 ? 1 : 0}"
                  title="{agents} subagents"
                ></span>
              </div>
            {/each}
          </div>
          <div class="week-labels">
            {#each weeks as [key] (key)}
              <span class="week-label">{weekLabel(key)}</span>
            {/each}
          </div>
        {/if}
      </section>

      <section class="card">
        <div class="card-head">
          <span class="card-title">Tools</span>
          <span class="card-sub">calls · error %</span>
        </div>
        {#if tools.length === 0}
          <p class="empty-card">No tool calls in this window.</p>
        {:else}
          <div class="tool-list">
            {#each visibleTools as tool (tool.name)}
              <div class="tool-row">
                <span class="tool-name" title={tool.name}>{tool.name}</span>
                <span class="track">
                  <span class="fill" style="width: {(tool.count / toolMax) * 100}%"></span>
                </span>
                <span class="num">{fmtCount(tool.count)}</span>
                <span
                  class="num err {errorTone(tool.errorPct)}"
                  title="{tool.errors} of {tool.count} calls errored"
                >
                  {tool.errorPct.toFixed(1)}%
                </span>
              </div>
            {/each}
          </div>
          {#if tools.length > TOOLS_COLLAPSED}
            <button
              type="button"
              class="tool-toggle"
              onclick={() => (toolsExpanded = !toolsExpanded)}
            >
              {toolsExpanded ? "Show fewer" : `Show all (${tools.length})`}
            </button>
          {/if}
        {/if}
      </section>
    </div>

    <!-- Row 3 — by workspace · activity · recent sessions -->
    <div class="row row3">
      <section class="card">
        <div class="ws-head">
          <span class="card-title">By workspace</span>
          <span class="num-head">Sess.</span>
          <span class="num-head">Tokens</span>
          <span class="num-head">Cost</span>
        </div>
        {#if projects.length === 0}
          <p class="empty-card">No sessions in this window.</p>
        {:else}
          {#each projects as [path, project] (path)}
            <div class="ws-row" title={path}>
              <span class="ws-name">
                <span class="dot" style="background: {workspaceColour(path)}"></span>
                <span
                  class="ws-bar"
                  style="width: {(project.sessions / projectMax) * 100}%"
                ></span>
                <span class="ws-text">{basename(path)}</span>
              </span>
              <span class="num">{project.sessions}</span>
              <span class="num">{fmtTokens(project.outputTokens)}</span>
              <span class="num strong">{fmtCost(project.cost)}</span>
            </div>
          {/each}
        {/if}
      </section>

      <section class="card activity-card">
        <div class="card-head">
          <span class="card-title">Activity</span>
          <span class="card-sub">sessions per day · {HEATMAP_DAYS}d</span>
        </div>
        <div class="activity">
          <div class="heatmap">
            {#each heatmap as day (day.date)}
              <span
                class="cell"
                style={cellStyle(day.stats.sessions)}
                title="{shortDate(day.date)} · {day.stats.sessions} sessions"
              ></span>
            {/each}
          </div>
          <div class="heat-caption">
            <span>{heatmap.length > 0 ? shortDate(heatmap[0].date) : ""}</span>
            <span>
              {heatmapPeak
                ? `peak ${shortDate(heatmapPeak.date)} · ${heatmapPeak.stats.sessions}`
                : "no sessions"}
            </span>
            <span>today</span>
          </div>
          <div class="heat-legend">
            <span>less</span>
            {#each [0, 1, Math.ceil(heatmapMax / 2), heatmapMax] as level, i (i)}
              <span class="cell legend-cell" style={cellStyle(level)}></span>
            {/each}
            <span>more</span>
          </div>
        </div>
      </section>

      <section class="card recent-card">
        <div class="recent-head">
          <span class="card-title">Recent sessions</span>
          <span>Workspace</span>
          <span>Model</span>
          <span class="num-head">Time</span>
          <span class="num-head">Output</span>
          <span class="num-head">Cost</span>
        </div>
        {#if recent.length === 0}
          <p class="empty-card">No sessions in this window.</p>
        {:else}
          <div class="recent-list">
            {#each recent as session (session.sessionId)}
              <!-- Reopens this conversation: New Session, Resume mode, this row picked. -->
              <button
                type="button"
                class="recent-row"
                onclick={() =>
                  openNewSession({
                    workspacePath: session.cwd ?? "",
                    resumeSessionId: session.sessionId,
                  })}
                title="{sessionTitle(session.title, session.sessionId)} · {session.lastTimestamp
                  ? agoLabel(session.lastTimestamp, now)
                  : 'unknown'}{session.gitBranch ? ` · ${session.gitBranch}` : ''}"
              >
                <span class="recent-title">
                  {sessionTitle(session.title, session.sessionId)}
                </span>
                <span class="recent-ws">
                  <span class="dot" style="background: {workspaceColour(session.cwd)}"></span>
                  <span class="ws-text">{session.cwd ? basename(session.cwd) : "—"}</span>
                </span>
                <span class="recent-model" style="color: {modelColour(session.model ?? '')}">
                  {session.model ?? "—"}
                </span>
                <span class="num">{fmtDuration(session.durationSecs)}</span>
                <span class="num">{fmtTokens(session.outputTokens)}</span>
                <span class="num strong">{fmtCost(session.costEstimate)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .stats-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 10px;
    min-height: 0;
    padding: 10px 16px 14px;
    overflow: auto;
    font-family: var(--font-ui);
    color: var(--text);
  }

  /* ── Range bar ─────────────────────────────────────────────────────────── */
  .range-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
  }

  .note {
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .spacer {
    flex: 1;
  }

  .live {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .empty-page {
    display: grid;
    place-items: center;
    flex: 1;
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  .kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    flex-shrink: 0;
    gap: 8px;
  }

  .kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 12px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }

  .kpi-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
  }

  .kpi-label {
    color: var(--muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .kpi-delta {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: 500;
  }

  .kpi-delta.up {
    color: var(--accent);
  }

  .kpi-delta.down {
    color: var(--danger);
  }

  .kpi-delta.flat {
    color: var(--muted);
  }

  .kpi-body {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
  }

  .kpi-value {
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    font-weight: 500;
    line-height: 1.1;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }

  .kpi-sub {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-variant-numeric: tabular-nums;
  }

  /* ── Card shell ────────────────────────────────────────────────────────── */
  .row {
    display: grid;
    flex-shrink: 0;
    gap: 10px;
  }

  .row2 {
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr) minmax(0, 3fr);
  }

  .row3 {
    grid-template-columns: minmax(0, 4fr) minmax(0, 3fr) minmax(0, 8fr);
  }

  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    overflow: hidden;
  }

  .card-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
  }

  .card-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .card-sub {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--fs-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-card {
    margin: 0;
    padding: 14px 12px;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .footnote {
    margin: 0;
    padding: 6px 12px;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }

  .num {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .num.strong {
    color: var(--text);
  }

  .num-head {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: right;
    text-transform: uppercase;
  }

  .dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 2px;
  }

  /* ── By model ──────────────────────────────────────────────────────────── */
  .model-head,
  .model-row {
    display: grid;
    grid-template-columns: 1.5fr repeat(var(--cols), minmax(0, 1fr));
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .model-head {
    padding: 7px 12px;
  }

  .model-col {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 2px;
  }

  .model-row {
    height: 24px;
    font-size: var(--fs-xs);
  }

  .model-row:hover {
    background: var(--surface2);
  }

  .model-label {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Sessions by week ──────────────────────────────────────────────────── */
  .weeks {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    height: 150px;
    padding: 12px 12px 6px;
  }

  .week {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    height: 100%;
  }

  .week-total {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .stack {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 26px;
    min-height: 2px;
    border-radius: var(--r-xs);
    background: var(--surface3);
    overflow: hidden;
  }

  .seg {
    display: block;
    width: 100%;
  }

  .agent-dot {
    display: block;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--accent);
  }

  .week-labels {
    display: flex;
    gap: 10px;
    padding: 0 12px 8px;
  }

  .week-label {
    flex: 1;
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Tools ─────────────────────────────────────────────────────────────── */
  /* 8 rows tall in both states: expanding scrolls here instead of growing the row.
     The reserved gutter keeps the bars the same width once the scrollbar appears. */
  .tool-list {
    max-height: 192px;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .tool-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(24px, 0.8fr) 38px 40px;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .tool-name {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track {
    height: 5px;
    border-radius: var(--r-xs);
    background: var(--surface3);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .err.danger {
    color: var(--danger);
  }

  .err.warn {
    color: var(--warn);
  }

  .err.muted {
    color: var(--muted);
  }

  .tool-toggle {
    padding: 6px 12px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-2xs);
    text-align: left;
    cursor: pointer;
  }

  .tool-toggle:hover {
    color: var(--text);
  }

  /* ── By workspace ──────────────────────────────────────────────────────── */
  .ws-head,
  .ws-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 40px 52px 56px;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .ws-head {
    padding: 7px 12px;
  }

  .ws-row {
    height: 24px;
  }

  .ws-row:hover {
    background: var(--surface2);
  }

  .ws-name {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* A faint session-count bar behind the name, not a separate column. */
  .ws-bar {
    position: absolute;
    left: 13px;
    top: 50%;
    height: 14px;
    transform: translateY(-50%);
    border-radius: var(--r-xs);
    background: var(--surface2);
    pointer-events: none;
  }

  .ws-text {
    position: relative;
    overflow: hidden;
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Activity heatmap ──────────────────────────────────────────────────── */
  .activity-card {
    min-height: 0;
  }

  .activity {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 10px 12px;
  }

  .heatmap {
    display: grid;
    grid-template-columns: repeat(15, minmax(0, 1fr));
    gap: 3px;
  }

  .cell {
    display: block;
    aspect-ratio: 1;
    border-radius: var(--r-xs);
  }

  .heat-caption {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }

  .heat-legend {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .legend-cell {
    width: 9px;
    height: 9px;
  }

  /* ── Recent sessions ───────────────────────────────────────────────────── */
  .recent-card {
    min-height: 0;
  }

  .recent-head,
  .recent-row {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) 90px 60px 52px 56px 52px;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .recent-head {
    padding: 7px 12px;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .recent-list {
    max-height: 216px;
    overflow-y: auto;
  }

  .recent-row {
    width: 100%;
    height: 24px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  .recent-row:hover {
    background: var(--surface2);
  }

  .recent-title {
    overflow: hidden;
    color: var(--text);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-ws {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .recent-model {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
