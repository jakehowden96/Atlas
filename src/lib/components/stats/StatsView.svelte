<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { save } from "@tauri-apps/plugin-dialog";
  import { basename } from "../../format";
  import { saveExport } from "../../ipc";
  import { errorMessage } from "../../ipc-error";
  import { toCsv, type Point } from "../../stats-chart";
  import {
    agoLabel,
    daySeries,
    delta,
    fmtCost,
    fmtCount,
    fmtDuration,
    fmtTokens,
    HEATMAP_DAYS,
    modelColour,
    modelRows,
    modelsForRange,
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
  import {
    buildExportData,
    exportCsv,
    exportJson,
    filterByBucket,
    sortRecent,
    type Bucket,
    type RecentSortKey,
  } from "../../stats-export";
  import { openSettings } from "../../stores/settings";
  import { reloadStats, statsError, statsLoading, statsSummary } from "../../stores/stats";
  import { showToast } from "../../stores/toast";
  import { openNewSession } from "../../stores/view";
  import { visibleWorkspaces } from "../../stores/workspace";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import Chip from "../ui/Chip.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import MenuButton from "../ui/MenuButton.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import Skeleton from "../ui/Skeleton.svelte";
  import ChartCard from "./charts/ChartCard.svelte";
  import HBarList from "./charts/HBarList.svelte";
  import Heatmap from "./charts/Heatmap.svelte";
  import Kpi from "./charts/Kpi.svelte";
  import StackedBars from "./charts/StackedBars.svelte";
  import type { Model } from "./charts/BarPlot.svelte";

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
  let bucket = $state<Bucket | null>(null);
  let sortKey = $state<RecentSortKey>("costEstimate");
  let sortDesc = $state(true);

  const rangeOptions: Segment<Range>[] = [
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
  let shownRecent = $derived(sortRecent(filterByBucket(recent, bucket), sortKey, sortDesc));

  // Fixed windows by design: the heatmap is always 30 days, the bar chart 8 weeks.
  let heatmap = $derived(summary ? daySeries(summary.byDay ?? {}, now, HEATMAP_DAYS) : []);
  let weeks = $derived(summary ? recentWeeks(summary.byWeek ?? {}, WEEK_COUNT) : []);
  let families = $derived(weekFamilies(weeks));

  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  /** Six KPI cards: value, delta against the previous window, sparkline. */
  let kpis = $derived.by(() => {
    if (!totals) return [];
    const cur = totals.current;
    const prev = totals.previous;
    const pct = (a: number, b: number | undefined) => {
      const d = delta(a, prev ? (b ?? 0) : null);
      return d.kind === "pct" ? d.value : undefined;
    };
    return [
      {
        label: "Sessions",
        value: fmtCount(cur.sessions),
        delta: pct(cur.sessions, prev?.sessions),
        spark: spark.map((d) => d.stats.sessions),
      },
      {
        label: "Messages sent",
        value: fmtCount(cur.userMessages),
        delta: pct(cur.userMessages, prev?.userMessages),
        spark: spark.map((d) => d.stats.userMessages),
      },
      {
        label: "Output tokens",
        value: fmtTokens(cur.outputTokens),
        delta: pct(cur.outputTokens, prev?.outputTokens),
        spark: spark.map((d) => d.stats.outputTokens),
      },
      {
        label: "Est. cost",
        value: fmtCost(cur.cost),
        delta: pct(cur.cost, prev?.cost),
        spark: spark.map((d) => d.stats.cost),
      },
      {
        label: "Peak context",
        value: fmtTokens(cur.peakContext),
        delta: pct(cur.peakContext, prev?.peakContext),
        spark: spark.map((d) => d.stats.peakContext),
      },
      {
        label: "Subagents",
        value: fmtCount(cur.subagents),
        delta: pct(cur.subagents, prev?.subagents),
        spark: spark.map((d) => d.stats.subagents),
      },
    ];
  });

  // ── Chart data ──────────────────────────────────────────────────────────
  let weekSeries = $derived(families.map((name) => ({ name, model: name.toLowerCase() as Model })));
  let weekBuckets = $derived(
    weeks.map(([key, w]) => ({
      key,
      label: weekLabel(key),
      parts: families.map((f) => w.byModel?.[f] ?? 0),
    })),
  );
  let weekPoints = $derived<Point[]>(
    weeks.map(([key, w]) => ({ key, label: weekLabel(key), value: w.sessions })),
  );
  let allToolPoints = $derived<Point[]>(
    tools.map((t) => ({
      key: t.name,
      label: t.name,
      value: t.count,
      context: t.errors > 0 ? `${t.errors} errors, ${t.errorPct.toFixed(1)}%` : "no errors",
    })),
  );
  let toolPoints = $derived(allToolPoints.slice(0, visibleTools.length));
  let projectPoints = $derived<Point[]>(
    projects.map(([path, p]) => ({ key: path, label: basename(path), value: p.cost })),
  );
  let dayPoints = $derived<Point[]>(
    heatmap.map((d) => ({ key: d.date, label: shortDate(d.date), value: d.stats.sessions })),
  );

  function select(kind: Bucket["kind"], key: string, label: string) {
    bucket = { kind, key, label };
  }

  /** Workspace colour from the workspace store, matched on the session's cwd. */
  function workspaceColour(path: string | null): string {
    if (!path) return "var(--surface3)";
    const key = normalise(path);
    const match = $visibleWorkspaces.find((w) => normalise(w.path) === key);
    return match?.color ?? "var(--surface3)";
  }

  function normalise(path: string): string {
    return path
      .replace(/[\\/]+$/, "")
      .replace(/\\/g, "/")
      .toLowerCase();
  }

  function sessionTitle(title: string | null, id: string): string {
    return title && title.trim().length > 0 ? title : id.slice(0, 8);
  }

  function sortBy(key: RecentSortKey) {
    if (sortKey === key) sortDesc = !sortDesc;
    else {
      sortKey = key;
      sortDesc = key !== "title" && key !== "cwd" && key !== "model";
    }
  }

  const ariaSort = (key: RecentSortKey) =>
    sortKey === key ? (sortDesc ? "descending" : "ascending") : "none";

  const recentColumns: { key: RecentSortKey; label: string; num?: boolean }[] = [
    { key: "title", label: "Session" },
    { key: "cwd", label: "Workspace" },
    { key: "model", label: "Model" },
    { key: "durationSecs", label: "Time", num: true },
    { key: "outputTokens", label: "Output", num: true },
    { key: "costEstimate", label: "Cost", num: true },
  ];

  let recentCsv = $derived(
    toCsv([
      ["Session", "Workspace", "Model", "Duration (s)", "Output tokens", "Cost (USD)"],
      ...shownRecent.map((s) => [
        sessionTitle(s.title, s.sessionId),
        s.cwd ?? "",
        s.model ?? "",
        s.durationSecs,
        s.outputTokens,
        s.costEstimate,
      ]),
    ]),
  );
  let modelsCsv = $derived(
    toCsv([["Metric", ...models.map(([f]) => f)], ...rows.map((r) => [r.label, ...r.values])]),
  );

  // ── Export ──────────────────────────────────────────────────────────────
  async function exportAs(format: "csv" | "json") {
    if (!summary) return;
    const data = buildExportData(summary, range, now);
    const text = format === "csv" ? exportCsv(data) : exportJson(data);
    try {
      const path = await save({
        defaultPath: `atlas-stats-${range}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      await saveExport(path, text);
      showToast("Stats exported", { type: "success", body: path });
    } catch (e) {
      showToast("Couldn't export stats", { body: errorMessage(e) });
    }
  }
</script>

<div class="stats-view">
  <!-- Range bar: drives every panel below except the two fixed-window charts. -->
  <div class="range-bar">
    <SegmentedControl
      role="radiogroup"
      label="Range"
      options={rangeOptions}
      value={range}
      onChange={(id) => (range = id)}
      size="sm"
    />
    <span class="note">
      {range === "all"
        ? "All time has no previous period to compare with"
        : `Deltas compare with the previous ${RANGE_LABELS[range]}`}
    </span>
    <div class="spacer"></div>
    <span class="live">
      ~/.claude transcripts, live, {summary ? agoLabel(summary.generatedAt, now) : "loading"}
    </span>
    <MenuButton
      label="Export"
      align="end"
      items={[
        { id: "csv", label: "Export CSV" },
        { id: "json", label: "Export JSON" },
      ]}
      onselect={(item) => void exportAs(item.id as "csv" | "json")}
    />
  </div>

  {#if loading && !summary}
    <div class="kpis" aria-busy="true" aria-label="Loading stats">
      {#each Array(6) as _, i (i)}
        <div class="card"><Skeleton height="var(--sp-8)" /></div>
      {/each}
    </div>
    <div class="row row2">
      {#each Array(3) as _, i (i)}
        <div class="card"><Skeleton height="var(--sp-10)" /></div>
      {/each}
    </div>
    <div class="row row3">
      {#each Array(3) as _, i (i)}
        <div class="card"><Skeleton height="var(--sp-10)" /></div>
      {/each}
    </div>
  {:else if !summary && $statsError}
    <Banner tone="error" title="Couldn't read stats">
      {$statsError}
      {#snippet actions()}
        <Button size="sm" onclick={() => void reloadStats()}>Retry</Button>
      {/snippet}
    </Banner>
  {:else if !summary}
    <EmptyState
      icon="search"
      title="No transcripts found"
      description="Atlas reads them from ~/.claude/projects"
    >
      {#snippet action()}
        <Button variant="link" onclick={() => openSettings("claude")}>
          Check Claude Code is installed
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="kpis">
      {#each kpis as kpi (kpi.label)}
        <div class="card">
          <Kpi
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            versus={`previous ${RANGE_LABELS[range]}`}
            spark={kpi.spark}
          />
        </div>
      {/each}
    </div>

    {#if bucket}
      <div class="filter">
        <Chip selected label={`Clear filter: ${bucket.label}`} onClick={() => (bucket = null)} />
      </div>
    {/if}

    <div class="row row2">
      <section class="card">
        <div class="card-head">
          <h3>By model</h3>
          <CopyButton value={modelsCsv} label="Copy by model as CSV" size="sm" />
        </div>
        {#if models.length === 0}
          <p class="empty-card">No sessions in this window</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                {#each models as [family] (family)}
                  <th scope="col" class="num">
                    <button
                      type="button"
                      class="plain"
                      aria-pressed={bucket?.kind === "model" && bucket.key === family}
                      onclick={() => select("model", family, family)}
                    >
                      <span class="swatch" style="background: {modelColour(family)}"></span>{family}
                    </button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.label)}
                <tr>
                  <th scope="row">{row.label}</th>
                  {#each row.values as value, i (models[i]?.[0] ?? i)}
                    <td class="num">{value}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="footnote">
            Model follows task difficulty. These are usage facts, not a controlled comparison
          </p>
        {/if}
      </section>

      <ChartCard
        id="weeks"
        title="Sessions by week"
        summary={`Sessions per week for the last ${WEEK_COUNT} weeks, stacked by model`}
        rows={weekPoints}
        unit="count"
      >
        <StackedBars
          series={weekSeries}
          buckets={weekBuckets}
          unit="count"
          label="Sessions by week"
          emptyText="No sessions yet"
          onselect={(key) => select("week", key, `week of ${weekLabel(key)}`)}
        />
      </ChartCard>

      <ChartCard
        id="tools"
        title="Tools"
        summary={`${plural(tools.length, "tool")} used in the last ${RANGE_LABELS[range]}, by call count`}
        rows={allToolPoints}
        unit="count"
      >
        <HBarList
          points={toolPoints}
          unit="count"
          label="Tool calls"
          emptyText="No tool calls in this window"
        />
        {#if tools.length > TOOLS_COLLAPSED}
          <Button variant="link" size="sm" onclick={() => (toolsExpanded = !toolsExpanded)}>
            {toolsExpanded ? "Show fewer" : `Show all (${tools.length})`}
          </Button>
        {/if}
      </ChartCard>
    </div>

    <div class="row row3">
      <ChartCard
        id="workspaces"
        title="By workspace"
        summary={`Estimated cost per workspace over the last ${RANGE_LABELS[range]}`}
        rows={projectPoints}
        unit="usd"
      >
        <HBarList
          points={projectPoints}
          unit="usd"
          label="Cost by workspace"
          emptyText="No sessions in this window"
          onselect={(key) => select("workspace", key, basename(key))}
        />
      </ChartCard>

      <ChartCard
        id="activity"
        title="Activity"
        summary={`Sessions per day over the last ${HEATMAP_DAYS} days`}
        rows={dayPoints}
        unit="count"
      >
        <Heatmap
          cells={dayPoints}
          noun="session"
          label="Sessions per day"
          emptyText="No sessions in this window"
          onselect={(key) => select("day", key, shortDate(key))}
        />
      </ChartCard>

      <section class="card recent-card">
        <div class="card-head">
          <h3>Recent sessions</h3>
          <CopyButton value={recentCsv} label="Copy recent sessions as CSV" size="sm" />
        </div>
        {#if shownRecent.length === 0}
          <p class="empty-card">No sessions in this window</p>
        {:else}
          <table>
            <thead>
              <tr>
                {#each recentColumns as col (col.key)}
                  <th scope="col" class:num={col.num} aria-sort={ariaSort(col.key)}>
                    <button type="button" class="plain" onclick={() => sortBy(col.key)}>
                      {col.label}
                    </button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each shownRecent as session (session.sessionId)}
                <tr>
                  <td class="title-cell">
                    <!-- Reopens this conversation: New Session, Resume mode, this row picked. -->
                    <button
                      type="button"
                      class="plain open"
                      onclick={() =>
                        openNewSession({
                          workspacePath: session.cwd ?? "",
                          resumeSessionId: session.sessionId,
                        })}
                    >
                      {sessionTitle(session.title, session.sessionId)}
                    </button>
                  </td>
                  <td>
                    <span class="dot" style="background: {workspaceColour(session.cwd)}"></span>
                    {session.cwd ? basename(session.cwd) : "None"}
                  </td>
                  <td style="color: {modelColour(session.model ?? '')}"
                    >{session.model ?? "None"}</td
                  >
                  <td class="num">{fmtDuration(session.durationSecs)}</td>
                  <td class="num">{fmtTokens(session.outputTokens)}</td>
                  <td class="num">{fmtCost(session.costEstimate)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
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
    gap: var(--sp-3);
    min-height: 0;
    padding: var(--sp-3) var(--sp-5) var(--sp-4);
    overflow: auto;
    font-family: var(--font-ui);
    color: var(--text);
  }

  .range-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-3);
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

  .kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    flex-shrink: 0;
    gap: var(--sp-3);
  }

  .row {
    display: grid;
    gap: var(--sp-3);
    align-items: start;
  }

  .row2,
  .row3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .row2,
    .row3 {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .card {
    min-width: 0;
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-3);
  }

  h3 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }

  .empty-card,
  .footnote {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .footnote {
    margin-top: var(--sp-3);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }

  th,
  td {
    padding: var(--sp-1) var(--sp-3);
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-weight: inherit;
  }

  thead th {
    color: var(--muted);
  }

  .num {
    text-align: right;
    font-family: var(--font-mono);
  }

  .plain {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
  }

  .plain:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 1px;
  }

  .title-cell {
    max-width: 0;
    width: 40%;
  }

  .open {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot,
  .swatch {
    display: inline-block;
    width: var(--sp-3);
    height: var(--sp-3);
    margin-right: var(--sp-2);
    border-radius: var(--r-pill);
  }

  .filter {
    display: flex;
  }
</style>
