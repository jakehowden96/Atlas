<script lang="ts">
  import { filterArgs, type Filters, type Overview } from "../../../../types/codeburn";
  import type { OptimizeReport } from "../../../../types/codeburn-optimize";
  import { statsFilters } from "../../../stores/statsFilters";
  import type { Point } from "../../../stats-chart";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import Button from "../../ui/Button.svelte";
  import Progress from "../../ui/Progress.svelte";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import Heatmap from "../charts/Heatmap.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Loader from "./Loader.svelte";
  import Panel from "./Panel.svelte";
  import Trend from "./Trend.svelte";
  import {
    activityCells,
    efficiencyRows,
    fmtMs,
    fmtPct,
    pace,
    trend,
    type Metric,
  } from "./overview-derive";
  import { monthCost } from "../../../stores/cost";

  let {
    filters,
    refresh,
    onOpenSession,
  }: { filters: Filters; refresh: number; onOpenSession?: (sessionId: string) => void } = $props();

  const actMetrics: Segment<"cost" | "turns">[] = [
    { id: "cost", label: "Cost" },
    { id: "turns", label: "Turns" },
  ];
  let actMetric = $state<"cost" | "turns">("cost");

  const metrics: Segment<Metric>[] = [
    { id: "cost", label: "Cost" },
    { id: "tokens", label: "Tokens" },
  ];

  let metric = $state<Metric>("cost");
  /** "all", or a provider id: the Stats provider filter, also set from the By tool panel. */
  const provider = $derived(filters.provider ?? "all");
  const setProvider = (id: string) =>
    statsFilters.update((f) => ({ ...f, provider: id === "all" ? undefined : id }));

  const args = $derived([
    "status",
    "--format",
    "menubar-json",
    ...filterArgs(filters, "status"),
    "--no-optimize",
  ]);

  function pts<T>(xs: T[], f: (x: T) => Point): Point[] {
    return xs.map(f);
  }

  const gradeTone = (g: string) => (/^[AB]/.test(g) ? "ok" : /^C/.test(g) ? "warn" : "bad");
</script>

<Loader {args} {refresh}>
  {#snippet children(overview: Overview)}
    {@const c = overview.current}
    {@const t = trend(overview.history.timeline, metric)}
    {@const inTok = c.inputTokens ?? 0}
    {@const live = overview.liveSessions?.sessions ?? []}
    {@const eff = efficiencyRows(c)}
    {@const cells = activityCells(overview)}
    {@const pc = pace(overview.history.daily, $monthCost, new Date())}

    {#snippet tile(label: string, value: string, note?: string, accent = false)}
      <div class="tile">
        <span class="k">{label}</span>
        <span class="v" class:accent>{value}</span>
        {#if note}<span class="n">{note}</span>{/if}
      </div>
    {/snippet}

    {#snippet table(head: string[], rows: (string | number)[][], empty = "No data")}
      {#if rows.length === 0}
        <p class="none">{empty}</p>
      {:else}
        <div class="scroll">
          <table>
            <thead>
              <tr>
                {#each head as h, i (h)}<th scope="col" class:r={i > 0}>{h}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each rows as row, ri (ri)}
                <tr>
                  {#each row as cell, i (i)}<td class:r={i > 0}>{cell}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/snippet}

    <section class="hero">
      <div class="hero-top">
        <div>
          <h3 class="eyebrow">{metric === "cost" ? "Est. cost" : "Tokens"} · {c.label}</h3>
          <p class="big">
            {metric === "cost" ? fmtCost(c.cost) : fmtTokens(inTok + c.outputTokens)}
          </p>
          <p class="sub">
            {fmtCount(c.calls)} calls · {c.sessionCountBasis === "partial"
              ? "at least "
              : ""}{c.sessions}
            sessions{#if overview.streak}
              · {overview.streak}-day streak{/if}
          </p>
        </div>
        <div class="tools">
          {#if provider !== "all"}
            <Button size="sm" onclick={() => setProvider("all")}>Showing {provider}. Clear</Button>
          {/if}
          <SegmentedControl
            role="radiogroup"
            label="Chart metric"
            options={metrics}
            value={metric}
            onChange={(id) => (metric = id)}
            size="sm"
          />
        </div>
      </div>
      <Trend
        days={t.days}
        series={t.series}
        unit={metric === "cost" ? "usd" : "tokens"}
        label={`${metric === "cost" ? "Spend" : "Token use"} over ${c.label}`}
      />
    </section>

    {#if live.length > 0}
      <Panel title="Live now" note="Context window of sessions active in the last 10 minutes">
        <div class="live">
          {#each live as s (s.id)}
            <div class="live-row">
              <span class="live-name">{s.project} <span class="muted">{s.model}</span></span>
              <Progress
                label={`${s.project} context window`}
                value={s.contextTokens}
                max={s.contextWindow}
                count={`${fmtTokens(s.contextTokens)} / ${fmtTokens(s.contextWindow)}`}
              />
            </div>
          {/each}
        </div>
      </Panel>
    {/if}

    <div class="tiles">
      {@render tile("Cost", fmtCost(c.cost), undefined, true)}
      {@render tile(
        "Tokens",
        fmtTokens(inTok + c.outputTokens),
        `in ${fmtTokens(inTok)} / out ${fmtTokens(c.outputTokens)}`,
      )}
      {@render tile("Calls", fmtCount(c.calls))}
      {@render tile(
        "Sessions",
        `${c.sessionCountBasis === "partial" ? "≥ " : ""}${c.sessions}`,
        c.sessionCountBasis === "partial" ? "at least; some are still open" : undefined,
      )}
      {@render tile("Cache hit", `${c.cacheHitPercent.toFixed(1)}%`)}
      {@render tile("Cache write", fmtTokens(c.cacheWriteTokens ?? 0))}
      {@render tile("Cache read", fmtTokens(c.cacheReadTokens ?? 0))}
      {@render tile("One-shot", `${Math.round(c.oneShotRate * 100)}%`)}
      {@render tile("Yesterday", pc.yesterday === null ? "—" : fmtCost(pc.yesterday))}
      {@render tile(
        "7-day average",
        pc.avg7 === null ? "—" : fmtCost(pc.avg7),
        `today ${fmtPct(pc.vsAvg7Pct)} vs average`,
      )}
      {@render tile("Month to date", $monthCost === null ? "—" : fmtCost($monthCost))}
      {@render tile(
        "Projected month",
        pc.projected === null ? "—" : fmtCost(pc.projected),
        "at this month's daily rate",
      )}
    </div>

    <div class="pair">
      <Panel title="Efficiency" note="Setup grade from codeburn optimize">
        <Loader
          args={["optimize", "--format", "json", ...filterArgs(filters, "optimize")]}
          {refresh}
        >
          {#snippet children(r: OptimizeReport)}
            <div class="grade-row">
              <span class="grade {gradeTone(r.summary.healthGrade)}">{r.summary.healthGrade}</span>
              <div>
                <p class="score"><span class="mono">{r.summary.healthScore}</span> / 100</p>
                <p class="sub">
                  {r.summary.findingCount} findings · {fmtCost(r.summary.potentialSavingsCostUSD)} potential
                  savings
                </p>
              </div>
            </div>
          {/snippet}
        </Loader>
        <div class="eff">
          {#each eff as r (r.label)}
            <div class="eff-row">
              <span>{r.label}</span>
              <span class="track"
                ><span
                  class="fill"
                  class:waste={r.good === "low"}
                  style:width={`${Math.min(100, r.pct)}%`}
                ></span></span
              >
              <span class="num">{r.pct.toFixed(1)}%</span>
            </div>
          {/each}
        </div>
        <p class="hint">
          Cache hit and one-shot are better high. Retry tax and routing waste are shares of spend,
          better low.
        </p>
      </Panel>

      <Panel title="Model efficiency" empty={!c.modelEfficiency?.length}>
        {@render table(
          ["Model", "Cost / edit", "One-shot"],
          (c.modelEfficiency ?? []).map((m) => [
            m.name,
            fmtCost(m.costPerEdit),
            `${Math.round(m.oneShotRate)}%`,
          ]),
        )}
      </Panel>
    </div>

    <div class="pair">
      <Panel
        title="By tool"
        note="Select one to filter"
        empty={!c.providerDetails?.some((p) => p.cost > 0)}
      >
        <HBarList
          points={pts(
            (c.providerDetails ?? []).filter((p) => p.cost > 0),
            (p) => ({
              key: p.id,
              label: p.label,
              value: p.cost,
              context: `${p.calls} calls`,
            }),
          )}
          unit="usd"
          label="Cost by tool"
          emptyText="No activity"
          onselect={(id) => setProvider(id)}
        />
      </Panel>
      <Panel title="Top models" empty={c.topModels.length === 0}>
        {@render table(
          ["Model", "Cost", "Calls", "Savings"],
          c.topModels.map((m) => [m.name, fmtCost(m.cost), m.calls, fmtCost(m.savingsUSD ?? 0)]),
        )}
      </Panel>
    </div>

    <div class="pair">
      <Panel title="Workflow" empty={!c.workflow}>
        {#if c.workflow}
          <div class="kv">
            <span>Correction rate</span><span
              >{(c.workflow.correctionRate * 100).toFixed(1)}% · {c.workflow.corrections}</span
            >
          </div>
          <div class="kv">
            <span>First-edit time</span><span>{fmtMs(c.workflow.medianTimeToFirstEditMs)}</span>
          </div>
          <div class="kv">
            <span>Pricing coverage</span><span>{Math.round((c.pricingCoverage ?? 0) * 100)}%</span>
          </div>
          <h4>Most reworked</h4>
          {#each c.topReworkedFiles ?? [] as f (f.path)}
            <div class="kv">
              <span class="path">{f.path}</span><span>{f.edits} edits · {f.sessions} sess</span>
            </div>
          {:else}
            <p class="none">No reworked files</p>
          {/each}
        {/if}
      </Panel>
      <Panel title="Savings & waste">
        <div class="kv">
          <span>Local-model savings</span><span>{fmtCost(c.localModelSavings?.totalUSD ?? 0)}</span>
        </div>
        <div class="kv">
          <span>Retry tax ({c.retryTax?.retries ?? 0} retries)</span><span
            class:warn={(c.retryTax?.totalUSD ?? 0) > 0}>{fmtCost(c.retryTax?.totalUSD ?? 0)}</span
          >
        </div>
        <div class="kv">
          <span
            >Routing waste (potential){#if c.routingWaste?.baselineModel}<span class="muted">
                vs {c.routingWaste.baselineModel}</span
              >{/if}</span
          ><span class:warn={(c.routingWaste?.totalSavingsUSD ?? 0) > 0}
            >{fmtCost(c.routingWaste?.totalSavingsUSD ?? 0)}</span
          >
        </div>
      </Panel>
    </div>

    <Panel title="Activity by day" note="Calls per day" empty={cells.length === 0}>
      <Heatmap {cells} noun="call" label="Calls per day" emptyText="No activity" />
    </Panel>

    <div class="pair">
      <Panel title="Top projects" empty={c.topProjects.length === 0}>
        {@render table(
          ["Project", "Cost", "Sessions", "Avg / session"],
          c.topProjects.map((p) => [
            p.name,
            fmtCost(p.cost),
            p.sessions,
            fmtCost(p.avgCostPerSession ?? (p.sessions ? p.cost / p.sessions : 0)),
          ]),
        )}
      </Panel>
      <Panel title="By activity" empty={c.topActivities.length === 0}>
        <SegmentedControl
          role="radiogroup"
          label="Activity metric"
          options={actMetrics}
          value={actMetric}
          onChange={(id) => (actMetric = id)}
          size="sm"
        />
        <HBarList
          points={pts(c.topActivities, (a) => ({
            key: a.name,
            label: a.name,
            value: actMetric === "cost" ? a.cost : a.turns,
            context:
              actMetric === "cost"
                ? `${a.turns} turns, ${Math.round(a.oneShotRate * 100)}% one-shot`
                : `${fmtCost(a.cost)}, ${Math.round(a.oneShotRate * 100)}% one-shot`,
          }))}
          unit={actMetric === "cost" ? "usd" : "count"}
          label={`${actMetric === "cost" ? "Cost" : "Turns"} by activity`}
          emptyText="No activity"
        />
      </Panel>
    </div>

    <div class="pair">
      <Panel title="Subagents" empty={!c.subagents?.length}>
        {@render table(
          ["Subagent", "Calls", "Cost"],
          (c.subagents ?? []).map((s) => [s.name, s.calls, fmtCost(s.cost)]),
        )}
      </Panel>
      <Panel title="Skills" empty={!c.skills?.length}>
        {@render table(
          ["Skill", "Turns", "Cost"],
          (c.skills ?? []).map((s) => [s.name, s.turns, fmtCost(s.cost)]),
        )}
      </Panel>
    </div>

    <div class="pair">
      <Panel title="MCP servers" empty={!c.mcpServers?.length}>
        {@render table(
          ["Server", "Calls"],
          (c.mcpServers ?? []).map((s) => [s.name, s.calls]),
        )}
      </Panel>
      <Panel title="By git branch" empty={c.byBranch.length === 0}>
        <HBarList
          points={pts(c.byBranch, (b) => ({
            key: b.branch,
            label: b.branch,
            value: b.cost,
            context: `${b.sessions} sessions`,
          }))}
          unit="usd"
          label="Cost by branch"
          emptyText="No activity"
        />
      </Panel>
    </div>

    <div class="pair">
      <Panel title="Tools" empty={c.tools.length === 0}>
        <HBarList
          points={pts(c.tools, (x) => ({ key: x.name, label: x.name, value: x.calls }))}
          unit="count"
          label="Tool calls"
          emptyText="No tool calls"
        />
      </Panel>
      <Panel title="Most expensive sessions" empty={!c.topSessions?.length}>
        {@render table(
          ["Project", "Date", "Calls", "Cost"],
          (c.topSessions ?? [])
            .slice(0, 3)
            .map((s) => [
              s.project.split(/[\\/]/).pop() ?? s.project,
              s.date,
              s.calls,
              fmtCost(s.cost),
            ]),
        )}
        {#if onOpenSession}
          <div class="open-row">
            {#each (c.topSessions ?? []).slice(0, 3) as s (s.sessionId)}
              <Button size="sm" onclick={() => onOpenSession(s.sessionId)}
                >Open {s.date} in Sessions</Button
              >
            {/each}
          </div>
        {/if}
      </Panel>
    </div>

    <p class="footnote">
      Dollar figures are API-equivalent estimates, not what a subscription bills.
    </p>
  {/snippet}
</Loader>

<style>
  .hero,
  .tile {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .hero {
    margin-bottom: var(--sp-4);
  }
  .hero-top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-4);
    margin-bottom: var(--sp-4);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .eyebrow {
    margin: 0;
    color: var(--accent);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .big {
    margin: var(--sp-1) 0;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: calc(var(--fs-2xl) * 1.6);
    font-weight: var(--fw-semi);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-4);
    margin-bottom: var(--sp-4);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .k {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .v {
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    font-weight: var(--fw-semi);
  }
  .v.accent {
    color: var(--accent);
  }
  .n {
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: var(--sp-4);
    margin-bottom: var(--sp-4);
  }
  @media (max-width: 900px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pair {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .open-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    margin-top: var(--sp-3);
  }

  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  th,
  td {
    padding: var(--sp-3) var(--sp-3);
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  th {
    border-bottom-color: var(--border2);
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
  }
  th:last-child,
  td:last-child {
    padding-right: 0;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .r {
    text-align: right;
  }
  td.r {
    font-family: var(--font-mono);
  }

  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) 0;
    font-size: var(--fs-xs);
  }
  .kv > :first-child {
    color: var(--muted);
  }
  .kv > :last-child {
    font-family: var(--font-mono);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .kv .path {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    font-weight: var(--fw-body);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    color: var(--warn);
  }
  .muted {
    color: var(--muted);
  }
  h4 {
    margin: var(--sp-4) 0 var(--sp-1);
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .none {
    margin: 0;
    padding: var(--sp-3) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .grade-row {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    margin-bottom: var(--sp-4);
  }
  .grade {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: var(--r-card);
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    font-weight: var(--fw-bold);
  }
  .grade.ok {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }
  .grade.warn {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .grade.bad {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }
  .score {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: var(--fw-semi);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .eff {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .eff-row {
    display: grid;
    grid-template-columns: minmax(90px, 1fr) minmax(0, 2fr) 56px;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-xs);
  }
  .track {
    height: var(--sp-3);
    border-bottom: 1px solid var(--border2);
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 0 var(--r-xs) var(--r-xs) 0;
    background: var(--accent);
  }
  .fill.waste {
    background: var(--warn);
  }
  .num {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    text-align: right;
  }
  .hint {
    margin: var(--sp-3) 0 0;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }

  .live {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .live-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
    align-items: center;
    gap: var(--sp-4);
    font-size: var(--fs-xs);
  }
  .live-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footnote {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
