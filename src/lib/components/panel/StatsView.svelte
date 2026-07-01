<script lang="ts">

  import type { UnlistenFn } from "@tauri-apps/api/event";
import { onDestroy, onMount } from "svelte";
  import type { ModelStats, StatsSummary, WeekStats } from "../../../types/stats";
  import { getClaudeStats, onStatsUpdate } from "../../ipc";
  import { log } from "../../logger";

  let summary = $state<StatsSummary | null>(null);
  let loading = $state(true);
  let unlisten: UnlistenFn | null = null;
  let range = $state<"all" | "30d" | "7d">("all");

  function models_for(s: StatsSummary, r: "all" | "30d" | "7d"): Record<string, ModelStats> {
    if (r === "7d") return s.byModel7d ?? {};
    if (r === "30d") return s.byModel30d ?? {};
    return s.byModel;
  }

  function subagent_models_for(s: StatsSummary, r: "all" | "30d" | "7d"): Record<string, ModelStats> {
    if (r === "7d") return s.byModelSubagents7d ?? {};
    if (r === "30d") return s.byModelSubagents30d ?? {};
    return s.byModelSubagents ?? {};
  }

  async function load() {
    loading = true;
    try {
      summary = await getClaudeStats();
    } catch (e) {
      log.error("stats", "getClaudeStats failed", e);
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    await load();
    unlisten = await onStatsUpdate((s) => {
      summary = s;
    });
  });

  onDestroy(() => {
    unlisten?.();
  });

  function fmt_duration(secs: number): string {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const h = Math.floor(m / 60);
    if (h >= 1) return `${h}h ${m % 60}m`;
    return `${m}m`;
  }

  function fmt_f1(n: number): string {
    return n.toFixed(1);
  }

  function fmt_tokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  function fmt_cost(n: number): string {
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    if (n >= 1) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(3)}`;
  }

  // Sort model families: Opus first, then Fable, Sonnet, Haiku, then others
  function sorted_models(by_model: Record<string, ModelStats>): [string, ModelStats][] {
    const order: Record<string, number> = { Opus: 0, Fable: 1, Sonnet: 2, Haiku: 3 };
    return Object.entries(by_model).sort(([a], [b]) => {
      const oa = order[a] ?? 99;
      const ob = order[b] ?? 99;
      return oa !== ob ? oa - ob : a.localeCompare(b);
    });
  }

  // Colour per model family for the weekly stacked bars
  const MODEL_COLOURS: Record<string, string> = {
    Opus: "#a78bfa",
    Fable: "#f59e0b",
    Sonnet: "#38bdf8",
    Haiku: "#f472b6",
  };
  const MODEL_ORDER = ["Opus", "Fable", "Sonnet", "Haiku"];

  function model_colour(family: string): string {
    return MODEL_COLOURS[family] ?? "#94a3b8";
  }

  function sorted_week_families(by_model: Record<string, number>): [string, number][] {
    const entries = Object.entries(by_model);
    return entries.sort(([a], [b]) => {
      const oa = MODEL_ORDER.indexOf(a);
      const ob = MODEL_ORDER.indexOf(b);
      const ra = oa === -1 ? 99 : oa;
      const rb = ob === -1 ? 99 : ob;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
  }

  function recent_weeks(by_week: Record<string, WeekStats>): [string, WeekStats][] {
    return Object.entries(by_week).sort(([a], [b]) => b.localeCompare(a));
  }

  // "2026-W22" -> "25–31 May" (the Mon–Sun dates of that ISO week)
  function week_label(weekKey: string): string {
    const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
    if (!m) return weekKey;
    const year = Number(m[1]);
    const week = Number(m[2]);
    // ISO week 1 contains Jan 4th; find that week's Monday, then offset.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Dow = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const mon = monday.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    const sun = sunday.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    return mon === sun
      ? `${monday.getUTCDate()}–${sunday.getUTCDate()} ${mon}`
      : `${monday.getUTCDate()} ${mon} – ${sunday.getUTCDate()} ${sun}`;
  }

  // Families present across shown weeks, in Opus→Fable→Sonnet→Haiku order
  function legend_families(weeks: [string, WeekStats][]): string[] {
    const seen = new Set<string>();
    for (const [, ws] of weeks) {
      for (const f of Object.keys(ws.byModel)) seen.add(f);
    }
    return [...seen].sort((a, b) => {
      const oa = MODEL_ORDER.indexOf(a);
      const ob = MODEL_ORDER.indexOf(b);
      return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    });
  }

  function legend_subagent_families(weeks: [string, WeekStats][]): string[] {
    const seen = new Set<string>();
    for (const [, ws] of weeks) {
      for (const f of Object.keys(ws.byModelSubagents ?? {})) seen.add(f);
    }
    return [...seen].sort((a, b) => {
      const oa = MODEL_ORDER.indexOf(a);
      const ob = MODEL_ORDER.indexOf(b);
      return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    });
  }
</script>

<div class="stats-view">
  <header class="stats-header">
    <div class="title-block">
      <h1 class="stats-title">Claude Code stats</h1>
      {#if summary}
        <span class="updated-label">
          {new Date(summary.generatedAt).toLocaleString()}
        </span>
      {/if}
    </div>
    <button class="refresh-btn" onclick={load} title="Refresh" disabled={loading}>
      <span class="material-symbols-outlined" class:spinning={loading}>refresh</span>
    </button>
  </header>

  {#if loading && !summary}
    <div class="loading-state">
      <span class="material-symbols-outlined loading-icon">progress_activity</span>
      <p>Scanning transcripts…</p>
    </div>
  {:else if summary}
    <div class="stats-body">

      <!-- Model comparison — lead element -->
      {#if Object.keys(summary.byModel).length > 0}
        {@const models = sorted_models(models_for(summary, range))}
        <section class="stats-section">
          <h2 class="section-title">
            <span class="material-symbols-outlined">compare</span>
            Model comparison
            <div class="range-toggle">
              <button class:active={range === "all"} onclick={() => (range = "all")}>All</button>
              <button class:active={range === "30d"} onclick={() => (range = "30d")}>30d</button>
              <button class:active={range === "7d"} onclick={() => (range = "7d")}>7d</button>
            </div>
          </h2>

          {#if models.length === 0}
            <p class="empty-window">No sessions in this window.</p>
          {:else}
          <div class="table-scroll">
            <table class="comparison-table">
              <thead>
                <tr>
                  <th class="metric-col">Metric</th>
                  {#each models as [family]}
                    <th class="model-col">{family}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="metric-label">Sessions</td>
                  {#each models as [, ms]}
                    <td class="model-val">{ms.sessions}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Output tokens</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_tokens(ms.outputTokens)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Est. cost</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_cost(ms.cost)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Peak context</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_tokens(ms.peakContextMax)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Avg session length</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_duration(ms.avgDurationSecs)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Avg messages sent</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_f1(ms.msgsPerSession)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Avg message length</td>
                  {#each models as [, ms]}
                    <td class="model-val">{Math.round(ms.avgMessageChars)} chars</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Tools / session</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_f1(ms.toolsPerSession)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Error rate</td>
                  {#each models as [, ms]}
                    <td class="model-val">{(ms.errorRate * 100).toFixed(1)}%</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Subagents / session</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_f1(ms.subagentsPerSession ?? 0)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Output / message</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_tokens(ms.avgOutputPerMsg ?? 0)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Cost / 1K output</td>
                  {#each models as [, ms]}
                    <td class="model-val">{fmt_cost((ms.costPerKOutput ?? 0))}</td>
                  {/each}
                </tr>
              </tbody>
            </table>
          </div>

          <p class="caveat">
            Model choice follows task difficulty, not random assignment — these are usage facts, not a controlled experiment.
          </p>
          {/if}
        </section>
      {/if}

      <!-- Subagent usage -->
      {#if sorted_models(subagent_models_for(summary, range)).length > 0}
        {@const subagent_models = sorted_models(subagent_models_for(summary, range))}
        <section class="stats-section">
          <h2 class="section-title">
            <span class="material-symbols-outlined">account_tree</span>
            Subagent usage
          </h2>
          <div class="table-scroll">
            <table class="comparison-table">
              <thead>
                <tr>
                  <th class="metric-col">Metric</th>
                  {#each subagent_models as [family]}
                    <th class="model-col">{family}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="metric-label">Invocations</td>
                  {#each subagent_models as [, ms]}
                    <td class="model-val">{ms.sessions}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Total cost</td>
                  {#each subagent_models as [, ms]}
                    <td class="model-val">{fmt_cost(ms.cost)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Cost / invocation</td>
                  {#each subagent_models as [, ms]}
                    <td class="model-val">{fmt_cost(ms.costPerSession)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Output / invocation</td>
                  {#each subagent_models as [, ms]}
                    <td class="model-val">{fmt_tokens(ms.outputPerSession)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Tools / invocation</td>
                  {#each subagent_models as [, ms]}
                    <td class="model-val">{fmt_f1(ms.toolsPerSession)}</td>
                  {/each}
                </tr>
                <tr>
                  <td class="metric-label">Error rate</td>
                  {#each subagent_models as [, ms]}
                    <td class="model-val">{(ms.errorRate * 100).toFixed(1)}%</td>
                  {/each}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      <!-- Headline totals -->
      <section class="stats-section">
        <h2 class="section-title">
          <span class="material-symbols-outlined">summarize</span>
          Totals
        </h2>
        <div class="totals-grid">
          <div class="total-card">
            <span class="total-value">{summary.totalSessions}</span>
            <span class="total-label">Sessions</span>
          </div>
          <div class="total-card">
            <span class="total-value">{summary.totalUserMessages.toLocaleString()}</span>
            <span class="total-label">Messages sent</span>
          </div>
          <div class="total-card">
            <span class="total-value">{fmt_tokens(summary.totalOutputTokens)}</span>
            <span class="total-label">Output tokens</span>
          </div>
          <div class="total-card">
            <span class="total-value">{fmt_cost(summary.totalCostEstimate)}</span>
            <span class="total-label">Est. cost</span>
          </div>
          <div class="total-card">
            <span class="total-value">{fmt_tokens(summary.peakContextOverall)}</span>
            <span class="total-label">Peak context</span>
          </div>
          <div class="total-card">
            <span class="total-value">{summary.totalSubagents}</span>
            <span class="total-label">Subagents</span>
          </div>
        </div>
      </section>

      <!-- By week — model split -->
      {#if summary.byWeek && Object.keys(summary.byWeek).length > 0}
        {@const weeks = recent_weeks(summary.byWeek)}
        {@const maxSessions = Math.max(...weeks.map(([, ws]) => ws.sessions))}
        {@const maxSubagents = Math.max(...weeks.map(([, ws]) => Object.values(ws.byModelSubagents ?? {}).reduce((a, b) => a + b, 0)), 1)}
        {@const families = legend_families(weeks)}
        <section class="stats-section">
          <h2 class="section-title">
            <span class="material-symbols-outlined">calendar_month</span>
            By week
          </h2>

          <!-- Legend -->
          <div class="week-legend">
            {#each families as family}
              <span class="legend-item">
                <span class="legend-dot" style="background: {model_colour(family)}"></span>
                {family}
              </span>
            {/each}
          </div>

          <div class="bar-list">
            {#each weeks as [week, ws]}
              {@const subagent_total = Object.values(ws.byModelSubagents ?? {}).reduce((a, b) => a + b, 0)}
              <div class="week-group">
                <span class="bar-label day-label" title={week}>{week_label(week)}</span>
                <div class="week-bars">
                  <span></span>
                  <div class="bar-track">
                    {#each sorted_week_families(ws.byModel) as [family, count]}
                      <div
                        class="bar-segment"
                        style="width: {(count / maxSessions) * 100}%; background: {model_colour(family)};"
                        title="{family}: {count} session{count === 1 ? '' : 's'}"
                      ></div>
                    {/each}
                  </div>
                  <span class="bar-count">{ws.sessions}</span>
                  {#if subagent_total > 0}
                    <span class="bar-type-label">Subagents</span>
                    <span></span>
                    <div class="bar-track bar-track--agents">
                      {#each sorted_week_families(ws.byModelSubagents ?? {}) as [family, count]}
                        <div
                          class="bar-segment"
                          style="width: {(count / maxSubagents) * 100}%; background: {model_colour(family)};"
                          title="{family} agents: {count}"
                        ></div>
                      {/each}
                    </div>
                    <span class="bar-count bar-count--agents">{subagent_total}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

    </div>
  {/if}
</div>

<style>
  .stats-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
    font-family: var(--font-body);
    overflow: hidden;
  }

  .stats-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem 0.6rem;
    border-bottom: 1px solid var(--outline-variant);
    flex-shrink: 0;
  }

  .title-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .stats-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    font-family: var(--font-display);
    color: var(--on-surface);
  }

  .updated-label {
    font-size: 0.7rem;
    color: var(--on-surface-variant);
  }

  .refresh-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: background 0.15s, color 0.15s;
  }

  .refresh-btn:hover {
    background: var(--surface-container-high);
    color: var(--on-surface);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    flex: 1;
    color: var(--on-surface-variant);
    opacity: 0.6;
  }

  .loading-icon {
    font-size: 2rem !important;
    animation: spin 1.5s linear infinite;
  }

  .stats-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .stats-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--on-surface-variant);
    margin: 0;
  }

  .section-title .material-symbols-outlined {
    font-size: 0.95rem !important;
  }

  /* Range toggle (segmented control) */
  .range-toggle {
    display: flex;
    margin-left: auto;
    gap: 2px;
    background: var(--surface-container);
    border-radius: var(--radius-sm);
    padding: 2px;
  }

  .range-toggle button {
    border: none;
    background: none;
    color: var(--on-surface-variant);
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 2px 7px;
    border-radius: calc(var(--radius-sm) - 2px);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .range-toggle button:hover {
    color: var(--on-surface);
  }

  .range-toggle button.active {
    background: var(--surface-container-highest);
    color: var(--on-surface);
  }

  .empty-window {
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    font-style: italic;
    margin: 0.2rem 0;
  }

  /* Comparison table */
  .table-scroll {
    overflow-x: auto;
  }

  .comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
    min-width: 300px;
  }

  .comparison-table th {
    padding: 0.35rem 0.6rem;
    text-align: left;
    background: var(--surface-container-low);
    color: var(--on-surface-variant);
    font-weight: 600;
    font-size: 0.72rem;
    border-bottom: 1px solid var(--outline-variant);
  }

  .comparison-table td {
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent);
    color: var(--on-surface);
  }

  .comparison-table tr:last-child td {
    border-bottom: none;
  }

  .comparison-table tr:hover td {
    background: var(--surface-container-low);
  }

  .metric-col {
    width: 40%;
  }

  .model-col {
    text-align: right !important;
  }

  .metric-label {
    color: var(--on-surface-variant);
    font-size: 0.75rem;
  }

  .model-val {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--on-surface);
  }

  .caveat {
    font-size: 0.68rem;
    color: var(--on-surface-variant);
    font-style: italic;
    margin: 0;
    line-height: 1.4;
  }

  /* Totals grid */
  .totals-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .total-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem 0.4rem;
    background: var(--surface-container-low);
    border-radius: var(--radius-sm);
    border: 1px solid var(--outline-variant);
    gap: 0.15rem;
  }

  .total-value {
    font-size: 1.05rem;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--primary);
    font-variant-numeric: tabular-nums;
  }

  .total-label {
    font-size: 0.65rem;
    color: var(--on-surface-variant);
    text-align: center;
  }

  /* Week legend */
  .week-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--on-surface-variant);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  /* Bar list */
  .bar-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  /* Legacy single-row layout (kept for non-week bar usage) */
  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.4rem;
  }

  /* Two-bar week layout */
  .week-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface-container-low);
    border-radius: var(--radius-sm);
    padding: 0.3rem 0.5rem;
  }

  .week-bars {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 52px 1fr 36px;
    row-gap: 3px;
    column-gap: 4px;
    align-items: center;
  }

  .bar-type-label {
    grid-column: 1 / -1;
    font-size: 0.6rem;
    color: var(--on-surface-variant);
    opacity: 0.7;
    text-align: left;
    margin-top: 2px;
  }

  .bar-label {
    min-width: 120px;
    font-size: 0.74rem;
    color: var(--on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .day-label {
    min-width: 98px;
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }

  .bar-track {
    height: 8px;
    background: var(--surface-container);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
  }

  .bar-track--agents {
    height: 5px;
    opacity: 0.8;
  }

  .bar-segment {
    height: 100%;
    min-width: 2px;
    transition: width 0.3s ease;
  }

  .bar-count {
    font-size: 0.7rem;
    color: var(--on-surface-variant);
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
  }

  .bar-count--agents {
    font-size: 0.62rem;
    opacity: 0.7;
  }

  .legend-divider {
    color: var(--outline-variant);
    font-size: 0.72rem;
  }

  .legend-item--subagent {
    opacity: 0.75;
  }

  .legend-dot--stripe {
    background: var(--c);
    opacity: 0.6;
  }
</style>
