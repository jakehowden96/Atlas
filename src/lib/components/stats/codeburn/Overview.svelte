<script lang="ts">
  import { filterArgs, type Filters, type Overview } from "../../../../types/codeburn";
  import type { PeriodCompare } from "../../../../types/codeburn-compare";
  import type { ModelRow } from "../../../../types/codeburn-models";
  import type { OptimizeReport } from "../../../../types/codeburn-optimize";
  import type { SessionRow } from "../../../../types/codeburn-sessions";
  import type { Yield } from "../../../../types/codeburn-yield";
  import { fmtCost, fmtCount, fmtTokens, localDayKey } from "../../../stats-derive";
  import { monthCost } from "../../../stores/cost";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import ActivityGrid from "../charts/ActivityGrid.svelte";
  import DailySpend from "../charts/DailySpend.svelte";
  import Ring from "../charts/Ring.svelte";
  import Sparkline from "../charts/Sparkline.svelte";
  import { tooltip } from "../../../ui/tooltip";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import { modelColor } from "./compare-derive";
  import { byCostDesc, isUnpriced } from "./models-derive";
  import {
    activityCells,
    efficiencyRows,
    efficiencyScore,
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
  /** "Nov 1" … "Nov 30": sparkline hover labels, index i is day i + 1. */
  const monthDays = Array.from({ length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }, (_, i) =>
    new Date(now.getFullYear(), now.getMonth(), i + 1).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleDateString(undefined, { month: "long" });
  const sign = (p: number | null | undefined) =>
    p === null || p === undefined ? "" : `${p >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(p))}%`;
  /** The one-shot rate is 0 when a category had no edit turns: show "—" rather than 0%. */
  const oneShot = (r: number) => (r > 0 ? `${Math.round(r * 100)}% one-shot` : "— one-shot");
</script>

<div class="page">
  <Loader {args} {refresh}>
    {#snippet children(o: Overview)}
      {@const c = o.current}
      {@const pc = pace(o.history.daily, $monthCost, now)}
      {@const eff = efficiencyRows(c)}
      {@const es = efficiencyScore(c)}      {@const cells = activityCells(o, now)}
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
      {@const mtd = $monthCost}
      {@const left = Math.max(1, dim - cum.length)}
      {@const fc =
        pc.projected !== null && mtd !== null
          ? Array.from({ length: left }, (_, j) => mtd + ((pc.projected! - mtd) * (j + 1)) / left)
          : []}

      <!-- 1. Hero -->
      <Card flush title={filters.period === "today" ? `Today (${localDayKey(now)})` : c.label}>
        {#snippet note()}
          {#if o.streak}<span class="pill warn">{o.streak}-day streak</span>{/if}
        {/snippet}
        <div class="hero">
          <div>
            <p class="big">{fmtCost(c.cost)}</p>
            <p class="sub">
              {fmtCount(c.calls)} calls · {c.sessionCountBasis === "partial" ? "at least " : ""}{c.sessions} sessions
            </p>
            <div class="stat3">
              <div><span>Yesterday</span><b>{pc.yesterday === null ? "—" : fmtCost(pc.yesterday)}</b></div>
              <div><span>7-day avg</span><b>{pc.avg7 === null ? "—" : fmtCost(pc.avg7)}</b></div>
              <div>
                <span>vs yesterday</span>
                <b class:up={(pc.vsYesterdayPct ?? 0) > 0} class:down={(pc.vsYesterdayPct ?? 0) < 0}>{fmtPct(pc.vsYesterdayPct)}</b>
              </div>
            </div>
          </div>
          <div>
            <p class="sub">Daily activity <b class="mono accent">{active} active days</b></p>
            <div class="gap-top"><ActivityGrid {cells} noun="call" /></div>
          </div>
          <div>
            <p class="sub">Efficiency</p>
            <div class="ring-wrap gap-top">
              <Ring value={es.score} grade={es.grade} label="Efficiency score" hint="Blend of one-shot rate, cache hit and retry tax" />
              <div class="efs">
                {#each eff as r (r.label)}
                  {@const right =
                    r.label === "Retry tax" && c.retryTax
                      ? `${fmtCost(c.retryTax.totalUSD)} · ${r.pct.toFixed(1)}% of spend`
                      : `${Math.round(r.pct)}%`}
                  <div class="ef" use:tooltip={{ text: `${r.label} ${right}`, delay: 0, side: "top" }}>
                    <div class="ef-h"><span>{r.label}</span><b>{right}</b></div>
                    <span class="t"><span class="f" class:bad={r.good === "low"} style:width={`${Math.max(2, Math.min(100, r.pct))}%`}></span></span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <!-- 2. Month to date / Projected month -->
      <div class="grid g2">
        <Card title="Month to date">
          <div class="ov-mp">
            <div>
              <div class="big sm">{mtd === null ? "—" : fmtCost(mtd)}</div>
              <Loader args={monthArgs} {refresh}>
                {#snippet children(p: PeriodCompare)}
                  {#if p.totals.pct.cost !== null}
                    <p class="sub">
                      <span class="pill" class:bad={p.totals.pct.cost > 0}>{sign(p.totals.pct.cost)}</span>
                      vs {lastMonth} pace
                    </p>
                  {/if}
                {/snippet}
              </Loader>
            </div>
            <Sparkline values={cum} labels={monthDays} format={fmtCost} label="Cumulative spend this month" />
          </div>
          {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("spend")}>See spend →</button>{/if}
        </Card>
        <Card title="Projected month">
          <div class="ov-mp">
            <div>
              <div class="big sm">{pc.projected === null ? "—" : fmtCost(pc.projected)} <small class="est">est</small></div>
              {#if pc.projected !== null && mtd !== null}
                <p class="sub"><span class="pill neutral">{fmtCost(Math.max(0, pc.projected - mtd))} to go</span></p>
              {/if}
            </div>
            <Sparkline values={[...cum, ...fc]} labels={monthDays} format={fmtCost} dashed label="Projected spend this month" />
          </div>
          {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("plans")}>See plans →</button>{/if}
        </Card>
      </div>

      <!-- 3. Daily spend -->
      <Card title="Daily spend">
        {#snippet note()}
          <span class="chips">
            <span class="pill neutral">Avg/day {bars.length ? fmtCost(bars.reduce((s, d) => s + d.total, 0) / bars.length) : "—"}</span>
            <span class="pill neutral">Peak {fmtCost(barPeak.total)} · {barPeak.label}</span>
            <span class="pill neutral">Yesterday {pc.yesterday === null ? "—" : fmtCost(pc.yesterday)}</span>
          </span>
        {/snippet}
        <DailySpend days={bars} series={stacked ? t.series : []} label="Daily spend" />
      </Card>

      <!-- 4. Workflow -->
      <Card title="Workflow">
        <div class="ov-pair">
          <div>
            <div class="sub">Correction rate</div>
            <div class="mono ov-big">{c.workflow ? `${(c.workflow.correctionRate * 100).toFixed(0)}%` : "—"}</div>
            <div class="sub">{c.workflow ? `${c.workflow.corrections} corrections` : ""}</div>
          </div>
          <div>
            <div class="sub">Time to first edit</div>
            <div class="mono ov-big">{c.workflow ? fmtMs(c.workflow.medianTimeToFirstEditMs) : "—"}</div>
            <div class="sub">median</div>
          </div>
        </div>
        <p class="sub mt">
          Top rework: {#if worst}<b class="mono">{worst.path}</b> · {worst.sessions} session{worst.sessions === 1 ? "" : "s"} · {worst.edits} edits{:else}—{/if}
        </p>
        <p class="sub">Corrections, first-edit latency, and file churn across your sessions.</p>
      </Card>

      <!-- 5. Pace banner -->
      <Loader args={weekArgs} {refresh}>
        {#snippet children(p: PeriodCompare)}
          {@const pct = p.totals.pct.cost}
          {@const driver = [...p.models].sort((a, b) => b.diff - a.diff)[0]}
          <Loader args={optArgs} {refresh}>
            {#snippet children(r: OptimizeReport)}
              <section class="card banner">
                <span class="muted">↗</span>
                <span>
                  {#if pct === null}
                    Not enough data from last week to compare pace.
                  {:else}
                    You're pacing <b>{Math.abs(Math.round(pct))}% {pct >= 0 ? "higher" : "lower"} than last week</b>{#if driver && driver.diff > 0}; <b>{driver.key}</b> is the biggest driver{/if}.
                  {/if}
                  <b class="mono">{fmtCost(r.summary.potentialSavingsCostUSD)}</b> is recoverable.
                  <span class="sub">(as of {asOf(o)})</span>
                </span>
                <span class="spacer"></span>
                {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("optimize")}>Review →</button>{/if}
              </section>
            {/snippet}
          </Loader>
        {/snippet}
      </Loader>

      <!-- 6. Wins / Improvements / Risks -->
      <section class="card">
        <div class="wir">
          <div class="wins">
            <h5>✓ Wins</h5>
            <ul>
              {#if c.cacheHitPercent >= 80}<li>Cache hit at {Math.round(c.cacheHitPercent)}%, most prompts reuse cache</li>{/if}
              {#if c.oneShotRate >= 0.7}<li>{Math.round(c.oneShotRate * 100)}% one-shot, edits land first try</li>{/if}
              {#if (o.streak ?? 0) >= 2}<li>{o.streak}-day usage streak</li>{/if}
            </ul>
          </div>
          <div class="imps">
            <h5>↗ Improvements</h5>
            <Loader args={optArgs} {refresh}>
              {#snippet children(r: OptimizeReport)}
                <ul>
                  {#each r.findings.filter((f) => f.class !== "keep").slice(0, 3) as f (f.id)}
                    <li>
                      <button type="button" class="ov-wi" onclick={() => onNavigate?.("optimize")}>
                        <span>{f.title}</span><span class="ov-asof">as of {asOf(o)}</span><b class="mono">{fmtCost(f.estimatedSavingsUSD)}</b>
                      </button>
                    </li>
                  {:else}
                    <li>No findings.</li>
                  {/each}
                </ul>
              {/snippet}
            </Loader>
          </div>
          <div class="risks">
            <h5>⚠ Risks</h5>
            <Loader args={monthArgs} {refresh}>
              {#snippet children(p: PeriodCompare)}
                <ul>
                  {#if barPeak.total > 0}<li>Peak day hit {fmtCost(barPeak.total)} on {barPeak.label}</li>{/if}
                  {#if pc.projected !== null}
                    <li>On pace for {fmtCost(pc.projected)} this month{p.totals.pct.cost !== null ? `, ${fmtPct(p.totals.pct.cost)} vs last` : ""}</li>
                  {/if}
                </ul>
              {/snippet}
            </Loader>
          </div>
        </div>
      </section>

      <!-- 7. Cost per outcome -->
      <Card title="Cost per outcome" note={`as of ${asOf(o)}`}>
        <Loader args={["yield", "--format", "json", ...filterArgs(filters, "yield")]} {refresh}>
          {#snippet children(y: Yield)}
            {@const commits = y.details.reduce((s, d) => s + d.commitCount, 0)}
            {@const prod = y.summary.productive}
            <div class="ov-pair">
              <div>
                <div class="sub">$ / commit</div>
                <div class="mono ov-big">{commits > 0 ? fmtCost(prod.costUSD / commits) : "—"}</div>
                <div class="sub"></div>
              </div>
              <div>
                <div class="sub">$ / productive session</div>
                <div class="mono ov-big">{prod.sessions > 0 ? fmtCost(prod.costUSD / prod.sessions) : "—"}</div>
                <div class="sub"></div>
              </div>
            </div>
            <p class="sub mt">
              productive {Math.round(prod.costPercent)}% · reverted {Math.round(y.summary.reverted.costPercent)}% · abandoned {Math.round(y.summary.abandoned.costPercent)}%
            </p>
            <p class="sub">Git-correlated. Reverted/abandoned = spend that didn't ship.</p>
          {/snippet}
        </Loader>
      </Card>

      <!-- 8. Models + sessions | Top activities -->
      <div class="grid g2 start">
        <div class="stack">
          <Card title="Models this period" note="Sorted by cost">
            <Loader args={["models", "--format", "json", ...filterArgs(filters, "models"), "--min-cost", "0"]} {refresh}>
              {#snippet children(rows: ModelRow[])}
                {@const top = byCostDesc(rows).slice(0, 5)}
                {@const names = top.map((r) => r.modelDisplayName)}
                <div class="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Model</th><th class="r">Input tok</th><th class="r">Output tok</th>
                        <th class="r">Cache read</th><th class="r">Cost</th><th class="r">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each top as m (m.providerDisplayName + m.modelDisplayName)}
                        <tr>
                          <td>
                            <span class="dot" style:background={modelColor(m.modelDisplayName, names)}></span>
                            <button type="button" class="link" onclick={() => onNavigate?.("models")}>{m.modelDisplayName}</button>
                          </td>
                          <td class="r">{fmtTokens(m.inputTokens)}</td>
                          <td class="r">{fmtTokens(m.outputTokens)}</td>
                          <td class="r">{fmtTokens(m.cacheReadTokens)}</td>
                          <td class="r">{isUnpriced(m) ? "—" : fmtCost(m.costUSD)}</td>
                          <td class="r">{fmtCount(m.calls)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/snippet}
            </Loader>
          </Card>
          <Card title="Most expensive sessions">
            {#snippet note()}
              {#if onNavigate}<button type="button" class="link" onclick={() => onNavigate("sessions")}>See all →</button>{/if}
            {/snippet}
            <Loader args={["sessions", "--format", "json", ...filterArgs(filters, "sessions")]} {refresh}>
              {#snippet children(rows: SessionRow[])}
                {#each [...rows].sort((a, b) => b.cost - a.cost).slice(0, 3) as s, i (s.sessionId)}
                  <button type="button" class="lrow" onclick={() => onOpenSession?.(s.sessionId)}>
                    <span class="i">{String(i + 1).padStart(2, "0")}</span>
                    <span class="b">
                      <b>{s.title}</b>
                      <span>{s.project} · {shortDay(s.startedAt.slice(0, 10))} · {s.models[0] ?? "—"} · {s.calls} calls</span>
                    </span>
                    <span class="v">{fmtCost(s.cost)} ›</span>
                  </button>
                {:else}
                  <p class="empty">No sessions in this range</p>
                {/each}
              {/snippet}
            </Loader>
          </Card>
        </div>

        <Card title="Top activities">
          {#snippet note()}
            <SegmentedControl
              role="radiogroup"
              label="Sort activities"
              options={actMetrics}
              value={actMetric}
              onChange={(id) => (actMetric = id)}
              size="sm"
            />
          {/snippet}
          {@const acts = [...c.topActivities].sort((a, b) => b[actMetric] - a[actMetric])}
          {@const top = Math.max(1e-9, ...acts.map((a) => a[actMetric]))}
          {#each acts as a (a.name)}
            <div class="ov-act">
              <div class="t"><div class="f" style:width={`${(a[actMetric] / top) * 100}%`}></div></div>
              <div class="kv"><b>{a.name}</b><span>{fmtCost(a.cost)}</span></div>
              <div class="kv">
                <span>{fmtCount(a.turns)} turn{a.turns === 1 ? "" : "s"}</span>
                <span>{oneShot(a.oneShotRate)}</span>
              </div>
            </div>
          {:else}
            <p class="empty">No activity.</p>
          {/each}
        </Card>
      </div>
    {/snippet}
  </Loader>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    max-width: 972px;
    margin: 0 auto;
  }
  :global(.page > .body) {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .grid {
    display: grid;
    gap: var(--sp-4);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .start {
    align-items: start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    min-width: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .accent {
    color: var(--accent);
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .mt {
    margin-top: var(--sp-3);
  }
  .muted {
    color: var(--muted);
  }
  .gap-top {
    margin-top: var(--sp-3);
  }
  .card {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  @media (max-width: 860px) {
    .grid,
    .hero {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* hero */
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1.35fr);
    gap: var(--sp-6);
    align-items: start;
  }
  .big {
    margin: var(--sp-1) 0;
    font-family: var(--font-mono);
    font-size: calc(var(--fs-2xl) * 1.6);
    font-weight: var(--fw-semi);
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .big.sm {
    font-size: var(--fs-2xl);
  }
  .est {
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: var(--fw-body);
    letter-spacing: 0;
  }
  .stat3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: var(--sp-5);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--border);
  }
  .stat3 > div {
    padding: 0 var(--sp-3);
  }
  .stat3 > div:first-child {
    padding-left: 0;
  }
  .stat3 > div + div {
    border-left: 1px solid var(--border);
  }
  .stat3 span {
    display: block;
    color: var(--muted);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
  .stat3 b {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
  }
  .up {
    color: var(--danger);
  }
  .down {
    color: var(--accent);
  }
  .ring-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
  }
  .efs {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
  }
  .ef {
    display: grid;
    gap: var(--sp-1);
    cursor: default;
  }
  .ef-h {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--sp-3);
    font-size: var(--fs-xs);
  }
  .ef-h span {
    white-space: nowrap;
  }
  .ef-h b {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ef .t {
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--surface3);
    overflow: hidden;
  }
  .ef .f {
    display: block;
    height: 100%;
    border-radius: var(--r-pill);
    background: var(--accent);
  }
  .ef .f.bad {
    background: var(--danger);
  }

  /* pills, links */
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    box-sizing: border-box;
  }
  .pill.warn {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .pill.bad {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }
  .pill.neutral {
    background: var(--surface3);
    color: var(--muted);
  }
  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: var(--fw-semi);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .link:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-3);
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* month / projected, paired stats */
  .ov-mp {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    gap: var(--sp-4);
    align-items: end;
    margin-bottom: var(--sp-3);
  }
  @media (max-width: 520px) {
    .ov-mp {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .ov-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }
  .ov-pair > div {
    padding: var(--sp-4);
  }
  .ov-pair > div + div {
    border-left: 1px solid var(--border);
  }
  .ov-big {
    font-size: var(--fs-xl);
    font-weight: var(--fw-semi);
  }

  /* banner */
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-4);
    font-size: var(--fs-sm);
  }
  .spacer {
    flex: 1;
  }

  /* wins / improvements / risks */
  .wir {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1fr);
    gap: var(--sp-5);
  }
  .wir h5 {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .wir ul {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .wins h5 {
    color: var(--accent);
  }
  .imps h5 {
    color: var(--warn);
  }
  .risks h5 {
    color: var(--danger);
  }
  .imps,
  .risks {
    padding-left: var(--sp-5);
    border-left: 1px solid var(--border);
  }
  @media (max-width: 760px) {
    .wir {
      grid-template-columns: minmax(0, 1fr);
    }
    .imps,
    .risks {
      padding-left: 0;
      border-left: 0;
    }
  }
  .ov-wi {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ov-wi:hover > span:first-child {
    text-decoration: underline;
  }
  .ov-wi > span:first-child {
    flex: 1;
    min-width: 0;
  }
  .ov-wi b {
    color: var(--text);
    font-weight: var(--fw-semi);
  }
  .ov-asof {
    color: var(--muted);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }

  /* models table */
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  th {
    padding: var(--sp-2);
    border-bottom: 1px solid var(--border2);
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    text-align: left;
    white-space: nowrap;
  }
  td {
    padding: var(--sp-3) var(--sp-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover {
    background: var(--surface2);
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
  }
  th:last-child,
  td:last-child {
    padding-right: 0;
  }
  .r {
    text-align: right;
  }
  td.r {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* sessions */
  .lrow {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    width: 100%;
    padding: var(--sp-3) 0;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .lrow:last-child {
    border-bottom: 0;
  }
  .lrow:hover {
    background: var(--surface2);
  }
  .lrow:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  .lrow .i {
    width: 22px;
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
  }
  .lrow .b {
    flex: 1;
    min-width: 0;
  }
  .lrow .b b {
    display: block;
    overflow: hidden;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lrow .b span {
    color: var(--muted);
  }
  .lrow .v {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }

  /* top activities */
  .ov-act {
    padding: var(--sp-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .ov-act > .t {
    height: 3px;
    margin-bottom: var(--sp-2);
    background: var(--surface3);
  }
  .ov-act > .t .f {
    height: 100%;
    background: var(--accent);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    font-size: var(--fs-xs);
  }
  .kv > :first-child {
    color: var(--muted);
  }
  .kv > :last-child {
    font-family: var(--font-mono);
    font-weight: var(--fw-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .kv > b {
    color: var(--text);
    font-family: var(--font-ui);
    font-weight: var(--fw-semi);
  }
  @media (max-width: 860px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
