<script lang="ts">
  import { filterArgs, type Filters, type Overview } from "../../../../types/codeburn";
  import type { PeriodCompare } from "../../../../types/codeburn-compare";
  import type { ModelRow } from "../../../../types/codeburn-models";
  import type { OptimizeReport } from "../../../../types/codeburn-optimize";
  import type { SessionRow } from "../../../../types/codeburn-sessions";
  import type { Yield } from "../../../../types/codeburn-yield";
  import { fmtCost, fmtCount, fmtTokens, localDayKey } from "../../../stats-derive";
  import { monthCost } from "../../../stores/cost";
  import Icon from "../../ui/Icon.svelte";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import DailyBars from "../charts/DailyBars.svelte";
  import Heatmap from "../charts/Heatmap.svelte";
  import Ring from "../charts/Ring.svelte";
  import Sparkline from "../charts/Sparkline.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import { byCostDesc, isUnpriced } from "./models-derive";
  import {
    activityCells,
    efficiencyRows,
    fmtMs,
    fmtPct,
    monthCumulative,
    monthWindows,
    pace,
    trend,
    weekWindows,
    type TrendDay,
  } from "./overview-derive";

  let {
    filters,
    refresh,
    onOpenSession,
    onNavigate,
  }: {
    filters: Filters;
    refresh: number;
    onOpenSession?: (sessionId: string) => void;
    /** Switches the Stats tab: "spend", "plans", "optimize", "sessions". */
    onNavigate?: (tab: string) => void;
  } = $props();

  const now = new Date();
  const actMetrics: Segment<"cost" | "turns">[] = [
    { id: "cost", label: "Cost" },
    { id: "turns", label: "Turns" },
  ];
  let actMetric = $state<"cost" | "turns">("cost");

  const args = $derived([
    "status",
    "--format",
    "menubar-json",
    ...filterArgs(filters, "status"),
    "--no-optimize",
  ]);
  const optArgs = $derived(["optimize", "--format", "json", ...filterArgs(filters, "optimize")]);
  const cmpArgs = (w: string[]) => [
    "compare-periods",
    "--format",
    "json",
    ...filterArgs(filters, "compare-periods"),
    ...w,
  ];
  const monthArgs = $derived(cmpArgs(monthWindows(now)));
  const weekArgs = $derived(cmpArgs(weekWindows(now)));

  const shortDay = (key: string) =>
    new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const asOf = (o: Overview) =>
    new Date(o.generated).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sign = (p: number | null | undefined) =>
    p === null || p === undefined ? "" : `${p >= 0 ? "↑" : "↓"}${Math.abs(Math.round(p))}%`;
  /** The one-shot rate is 0 when a category had no edit turns: show "—" rather than 0%. */
  const oneShot = (r: number) => (r > 0 ? `${Math.round(r * 100)}% one-shot` : "— one-shot");
</script>

<div class="page">
  <Loader {args} {refresh}>
    {#snippet children(o: Overview)}
      {@const c = o.current}
      {@const pc = pace(o.history.daily, $monthCost, now)}
      {@const eff = efficiencyRows(c)}
      {@const cells = activityCells(o, now)}
      {@const active = cells.filter((x) => x.value > 0).length}
      {@const worst = (c.topReworkedFiles ?? [])[0]}
      {@const t = trend(o.history.timeline, "cost")}
      {@const stacked = (o.history.timeline?.bucketMinutes ?? 0) >= 1440 && t.days.length > 1}
      {@const bars = stacked
        ? t.days
        : o.history.daily.slice(-30).map<TrendDay>((d) => ({
            key: d.date,
            label: shortDay(d.date),
            total: d.cost,
            parts: {},
          }))}
      {@const barPeak = bars.reduce((m, d) => (d.total > m.total ? d : m), bars[0] ?? { total: 0, label: "" })}
      {@const cum = monthCumulative(o.history.daily, now)}
      {@const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}

      <!-- 1. Hero -->
      <Card
        title={filters.period === "today" ? `Today (${localDayKey(now)})` : c.label}
        note={o.streak ? `${o.streak}-day streak` : undefined}
      >
        <div class="hero">
          <div class="col">
            <p class="big">{fmtCost(c.cost)}</p>
            <p class="muted">
              {fmtCount(c.calls)} calls · {c.sessionCountBasis === "partial" ? "at least " : ""}{c.sessions}
              sessions
            </p>
            <dl class="trio">
              <div><dt>Yesterday</dt><dd>{pc.yesterday === null ? "—" : fmtCost(pc.yesterday)}</dd></div>
              <div><dt>7-day avg</dt><dd>{pc.avg7 === null ? "—" : fmtCost(pc.avg7)}</dd></div>
              <div><dt>vs yesterday</dt><dd class:up={(pc.vsYesterdayPct ?? 0) > 0}>{fmtPct(pc.vsYesterdayPct)}</dd></div>
            </dl>
          </div>
          <div class="col">
            <p class="muted">Daily activity <b class="accent">{active} active days</b></p>
            <Heatmap {cells} noun="call" label="Calls per day" emptyText="No activity" compact />
          </div>
          <div class="col">
            <p class="muted">Efficiency</p>
            <div class="eff">
              <Loader args={optArgs} {refresh}>
                {#snippet children(r: OptimizeReport)}
                  <div class="ringbox">
                    <Ring value={r.summary.healthScore} label="Efficiency score" />
                    <span class="grade">{r.summary.healthGrade}</span>
                  </div>
                {/snippet}
              </Loader>
              <div class="rows">
                {#each eff as r (r.label)}
                  <div class="erow">
                    <span>{r.label}</span>
                    <span class="num">
                      {r.label === "Retry tax" && c.retryTax
                        ? `${fmtCost(c.retryTax.totalUSD)} · ${r.pct.toFixed(1)}% of spend`
                        : `${Math.round(r.pct)}%`}
                    </span>
                    <span class="track"
                      ><span
                        class="fill"
                        class:waste={r.good === "low"}
                        style:width={`${Math.min(100, r.pct)}%`}
                      ></span></span
                    >
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <!-- 2. Month to date / Projected month -->
      <div class="pair">
        <Card title="Month to date">
          <p class="big sm">{$monthCost === null ? "—" : fmtCost($monthCost)}</p>
          <Loader args={monthArgs} {refresh}>
            {#snippet children(p: PeriodCompare)}
              {#if p.totals.pct.cost !== null}
                <p class="muted">
                  <span class="pill" class:up={p.totals.pct.cost > 0}>{sign(p.totals.pct.cost)}</span>
                  vs last month pace
                </p>
              {/if}
            {/snippet}
          </Loader>
          <Sparkline values={cum} slots={dim} label="Cumulative spend this month" />
          {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("spend")}>See spend →</button>{/if}
        </Card>
        <Card title="Projected month">
          <p class="big sm">
            {pc.projected === null ? "—" : fmtCost(pc.projected)} <span class="muted">est</span>
          </p>
          {#if pc.projected !== null && $monthCost !== null}
            <p class="muted"><span class="pill">{fmtCost(Math.max(0, pc.projected - $monthCost))} to go</span></p>
          {/if}
          <Sparkline
            values={cum}
            slots={dim}
            forecast={pc.projected ?? undefined}
            label="Projected spend this month"
          />
          {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("plans")}>See plans →</button>{/if}
        </Card>
      </div>

      <!-- 3. Daily spend -->
      <Card title="Daily spend">
        {#snippet note()}
          <span class="chips">
            <span class="chip">Avg/day {bars.length ? fmtCost(bars.reduce((s, d) => s + d.total, 0) / bars.length) : "—"}</span>
            <span class="chip">Peak {fmtCost(barPeak.total)} · {barPeak.label}</span>
            <span class="chip">Yesterday {pc.yesterday === null ? "—" : fmtCost(pc.yesterday)}</span>
          </span>
        {/snippet}
        <DailyBars days={bars} series={stacked ? t.series : []} unit="usd" label="Daily spend" />
      </Card>

      <!-- 4. Workflow -->
      <Card title="Workflow">
        <div class="cells">
          <div>
            <span class="k">Correction rate</span>
            <b class="v">{c.workflow ? `${(c.workflow.correctionRate * 100).toFixed(0)}%` : "—"}</b>
            <span class="k">{c.workflow ? `${c.workflow.corrections} corrections` : ""}</span>
          </div>
          <div>
            <span class="k">Time to first edit</span>
            <b class="v">{c.workflow ? fmtMs(c.workflow.medianTimeToFirstEditMs) : "—"}</b>
            <span class="k">median</span>
          </div>
        </div>
        <p class="muted">
          Top rework: {#if worst}<code>{worst.path}</code> · {worst.sessions} session{worst.sessions === 1 ? "" : "s"} · {worst.edits} edits{:else}—{/if}
        </p>
        <p class="muted">Corrections, first-edit latency, and file churn across your sessions.</p>
      </Card>

      <!-- 5. Pace banner -->
      <Loader args={weekArgs} {refresh}>
        {#snippet children(p: PeriodCompare)}
          {@const pct = p.totals.pct.cost}
          {@const driver = [...p.models].sort((a, b) => b.diff - a.diff)[0]}
          <Loader args={optArgs} {refresh}>
            {#snippet children(r: OptimizeReport)}
              <div class="banner">
                <span>
                  {#if pct === null}
                    Not enough data from last week to compare pace.
                  {:else}
                    You're pacing <b>{Math.abs(Math.round(pct))}% {pct >= 0 ? "higher" : "lower"}</b> than last week{#if driver && driver.diff > 0}; <b>{driver.key}</b> is the biggest driver{/if}.
                  {/if}
                  <b>{fmtCost(r.summary.potentialSavingsCostUSD)}</b> is recoverable.
                  <span class="muted">(as of {asOf(o)})</span>
                </span>
                {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("optimize")}>Review →</button>{/if}
              </div>
            {/snippet}
          </Loader>
        {/snippet}
      </Loader>

      <!-- 6. Wins / Improvements / Risks -->
      <Card title="Wins, improvements, risks">
        <div class="three">
          <div>
            <h4 class="ok">Wins</h4>
            {#if c.cacheHitPercent >= 80}<p>Cache hit at {Math.round(c.cacheHitPercent)}%, most prompts reuse cache</p>{/if}
            {#if c.oneShotRate >= 0.7}<p>{Math.round(c.oneShotRate * 100)}% one-shot, edits land first try</p>{/if}
            {#if (o.streak ?? 0) >= 2}<p>{o.streak}-day usage streak</p>{/if}
          </div>
          <div>
            <h4 class="warn">Improvements</h4>
            <Loader args={optArgs} {refresh}>
              {#snippet children(r: OptimizeReport)}
                {#each r.findings.filter((f) => f.class !== "keep").slice(0, 3) as f (f.id)}
                  <p class="imp"><span>{f.title}</span><span class="num">as of {asOf(o)} {fmtCost(f.estimatedSavingsUSD)}</span></p>
                {:else}
                  <p class="muted">No findings.</p>
                {/each}
              {/snippet}
            </Loader>
          </div>
          <div>
            <h4 class="bad">Risks</h4>
            {#if barPeak.total > 0}<p>Peak day {fmtCost(barPeak.total)} on {barPeak.label}</p>{/if}
            <Loader args={monthArgs} {refresh}>
              {#snippet children(p: PeriodCompare)}
                {#if pc.projected !== null && p.totals.pct.cost !== null}
                  <p>On pace for {fmtCost(pc.projected)} this month, {fmtPct(p.totals.pct.cost)} vs last</p>
                {/if}
              {/snippet}
            </Loader>
          </div>
        </div>
      </Card>

      <!-- 7. Cost per outcome -->
      <Card title="Cost per outcome" note={`as of ${asOf(o)}`}>
        <Loader args={["yield", "--format", "json", ...filterArgs(filters, "yield")]} {refresh}>
          {#snippet children(y: Yield)}
            {@const commits = y.details.reduce((s, d) => s + d.commitCount, 0)}
            {@const prod = y.summary.productive}
            <div class="cells">
              <div>
                <span class="k">$ / commit</span>
                <b class="v">{commits > 0 ? fmtCost(prod.costUSD / commits) : "—"}</b>
              </div>
              <div>
                <span class="k">$ / productive session</span>
                <b class="v">{prod.sessions > 0 ? fmtCost(prod.costUSD / prod.sessions) : "—"}</b>
              </div>
            </div>
            <p class="muted">
              productive {Math.round(prod.costPercent)}% · reverted {Math.round(y.summary.reverted.costPercent)}% · abandoned {Math.round(y.summary.abandoned.costPercent)}%
            </p>
            <p class="muted">Git-correlated. Reverted/abandoned = spend that didn't ship.</p>
          {/snippet}
        </Loader>
      </Card>

      <!-- 8. Models + sessions | Top activities -->
      <div class="pair top">
        <div class="stack">
          <Card title="Models this period" note="Sorted by cost">
            <Loader args={["models", "--format", "json", ...filterArgs(filters, "models"), "--min-cost", "0"]} {refresh}>
              {#snippet children(rows: ModelRow[])}
                <table class="cb-table">
                  <thead>
                    <tr>
                      <th>Model</th><th class="num">Input tok</th><th class="num">Output tok</th>
                      <th class="num">Cache read</th><th class="num">Cost</th><th class="num">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each byCostDesc(rows).slice(0, 5) as m (m.providerDisplayName + m.modelDisplayName)}
                      <tr>
                        <td class="accent">{m.modelDisplayName}</td>
                        <td class="num">{fmtTokens(m.inputTokens)}</td>
                        <td class="num">{fmtTokens(m.outputTokens)}</td>
                        <td class="num">{fmtTokens(m.cacheReadTokens)}</td>
                        <td class="num">{isUnpriced(m) ? "—" : fmtCost(m.costUSD)}</td>
                        <td class="num">{fmtCount(m.calls)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/snippet}
            </Loader>
          </Card>
          <Card title="Most expensive sessions">
            {#snippet note()}
              {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("sessions")}>See all →</button>{/if}
            {/snippet}
            <Loader args={["sessions", "--format", "json", ...filterArgs(filters, "sessions")]} {refresh}>
              {#snippet children(rows: SessionRow[])}
                {#each [...rows].sort((a, b) => b.cost - a.cost).slice(0, 2) as s, i (s.sessionId)}
                  <button type="button" class="sess" onclick={() => onOpenSession?.(s.sessionId)}>
                    <span class="idx">{String(i + 1).padStart(2, "0")}</span>
                    <span class="grow">
                      <b>{s.title}</b>
                      <span class="muted">{s.project} · {shortDay(s.startedAt.slice(0, 10))} · {s.models[0] ?? "—"} · {s.calls} calls</span>
                    </span>
                    <span class="num">{fmtCost(s.cost)}</span>
                    <Icon name="chevron_right" size={16} />
                  </button>
                {:else}
                  <p class="muted">No sessions.</p>
                {/each}
              {/snippet}
            </Loader>
          </Card>
        </div>

        <Card title="Top activities">
          {#snippet note()}
            <SegmentedControl
              role="radiogroup"
              label="Activity metric"
              options={actMetrics}
              value={actMetric}
              onChange={(id) => (actMetric = id)}
              size="sm"
            />
          {/snippet}
          {@const acts = [...c.topActivities].sort((a, b) => b[actMetric] - a[actMetric])}
          {@const top = Math.max(1e-9, ...acts.map((a) => a[actMetric]))}
          {#each acts as a (a.name)}
            <div class="act">
              <span class="bar"><i style:width={`${(a[actMetric] / top) * 100}%`}></i></span>
              <span class="row"><b>{a.name}</b><span class="num">{actMetric === "cost" ? fmtCost(a.cost) : a.turns}</span></span>
              <span class="row muted">
                <span>{actMetric === "cost" ? `${a.turns} turn${a.turns === 1 ? "" : "s"}` : fmtCost(a.cost)}</span>
                <span>{oneShot(a.oneShotRate)}</span>
              </span>
            </div>
          {:else}
            <p class="muted">No activity.</p>
          {/each}
        </Card>
      </div>

      <p class="muted">Dollar figures are API-equivalent estimates, not what a subscription bills.</p>
    {/snippet}
  </Loader>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    max-width: 920px;
    margin: 0 auto;
  }
  :global(.page > .body) {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  .pair.top {
    align-items: start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    min-width: 0;
  }
  @media (max-width: 800px) {
    .pair,
    .hero,
    .three,
    .cells {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .hero {
    display: grid;
    grid-template-columns: 1fr 1.3fr 1.3fr;
    gap: var(--sp-6);
  }
  .col {
    min-width: 0;
  }
  .big {
    margin: 0;
    font-family: var(--font-mono);
    font-size: calc(var(--fs-2xl) * 1.6);
    font-weight: var(--fw-bold);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .big.sm {
    font-size: var(--fs-2xl);
  }
  .muted {
    margin: var(--sp-1) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .accent {
    color: var(--accent);
  }
  .trio {
    display: flex;
    gap: var(--sp-5);
    margin: var(--sp-4) 0 0;
    padding-top: var(--sp-3);
    border-top: 1px solid var(--border);
  }
  .trio dt {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .trio dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .up {
    color: var(--danger);
  }

  .eff {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
  }
  .ringbox {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-1);
  }
  .grade {
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-bold);
  }
  .rows {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .erow {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--sp-1);
    font-size: var(--fs-2xs);
  }
  .erow .track {
    grid-column: 1 / -1;
  }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: var(--sp-1);
    border-radius: var(--r-pill);
    background: var(--surface3);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .fill.waste {
    background: var(--danger);
  }

  .pill,
  .chip {
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: var(--surface3);
    font-size: var(--fs-2xs);
  }
  .pill.up {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }
  .chips {
    display: inline-flex;
    gap: var(--sp-2);
  }
  .link {
    all: unset;
    color: var(--accent);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    cursor: pointer;
  }
  .link:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }

  .cells {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }
  .cells > div {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    padding: var(--sp-4);
  }
  .cells > div + div {
    border-left: 1px solid var(--border);
  }
  .k {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .v {
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
  }
  code {
    font-family: var(--font-mono);
    color: var(--text);
  }

  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    font-size: var(--fs-sm);
  }
  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-6);
    font-size: var(--fs-xs);
  }
  .three h4 {
    margin: 0 0 var(--sp-2);
    font-size: var(--fs-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .three p {
    margin: var(--sp-1) 0;
  }
  .ok {
    color: var(--accent);
  }
  .warn {
    color: var(--warn);
  }
  .bad {
    color: var(--danger);
  }
  .imp {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
  }
  .imp .num {
    color: var(--muted);
    white-space: nowrap;
  }

  .sess {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    width: 100%;
    padding: var(--sp-3) 0;
    border-top: 1px solid var(--border);
    cursor: pointer;
  }
  .sess:first-child {
    border-top: 0;
  }
  .sess:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  .sess .grow {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  .sess .grow .muted {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .idx {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .act {
    padding: var(--sp-3) 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .act:last-child {
    border-bottom: 0;
  }
  .act .bar {
    display: block;
    height: 2px;
    margin-bottom: var(--sp-2);
  }
  .act .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .act .row {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
  }
  .act .muted {
    margin: 0;
  }
</style>
