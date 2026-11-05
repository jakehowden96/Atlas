<script lang="ts">
  import type { Overview, Period } from "../../../../types/codeburn";
  import type { Point } from "../../../stats-chart";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import BarChart from "../charts/BarChart.svelte";
  import ChartCard from "../charts/ChartCard.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";

  let { period, refresh }: { period: Period; refresh: number } = $props();

  const DAYS = 30;

  function points(overview: Overview) {
    const c = overview.current;
    const day: Point[] = overview.history.daily.slice(-DAYS).map((d) => ({
      key: d.date,
      label: d.date.slice(5),
      value: d.cost,
    }));
    const task: Point[] = c.topActivities.map((a) => ({
      key: a.name,
      label: a.name,
      value: a.cost,
      context: `${a.turns} turns, ${Math.round(a.oneShotRate * 100)}% one-shot`,
    }));
    const model: Point[] = c.topModels.map((m) => ({ key: m.name, label: m.name, value: m.cost }));
    const project: Point[] = c.topProjects.map((p) => ({ key: p.id, label: p.name, value: p.cost }));
    const branch: Point[] = c.byBranch.map((b) => ({ key: b.branch, label: b.branch, value: b.cost }));
    const tool: Point[] = c.tools.map((t) => ({ key: t.name, label: t.name, value: t.calls }));
    return { day, task, model, project, branch, tool };
  }
</script>

<Loader
  args={["status", "--format", "menubar-json", "--period", period, "--no-timeline", "--no-optimize"]}
  {refresh}
>
  {#snippet children(overview: Overview)}
    {@const c = overview.current}
    {@const p = points(overview)}
    <div class="kpis">
      <div class="card"><Kpi label="Est. cost" value={fmtCost(c.cost)} /></div>
      <div class="card">
        <Kpi
          label={c.sessionCountBasis === "partial" ? "Sessions (at least)" : "Sessions"}
          value={fmtCount(c.sessions)}
        />
      </div>
      <div class="card"><Kpi label="API calls" value={fmtCount(c.calls)} /></div>
      <div class="card"><Kpi label="Output tokens" value={fmtTokens(c.outputTokens)} /></div>
      <div class="card"><Kpi label="Cache hit" value={`${c.cacheHitPercent.toFixed(1)}%`} /></div>
      <div class="card"><Kpi label="One-shot rate" value={`${Math.round(c.oneShotRate * 100)}%`} /></div>
    </div>

    <div class="row">
      <ChartCard
        id="cb-daily"
        title="Daily spend"
        summary={`Estimated cost per day for the last ${DAYS} days`}
        rows={p.day}
        unit="usd"
      >
        <BarChart points={p.day} unit="usd" label="Daily spend" emptyText="No spend yet" />
      </ChartCard>
      <ChartCard
        id="cb-task"
        title="By task"
        summary={`Estimated cost per task type, ${c.label}`}
        rows={p.task}
        unit="usd"
      >
        <HBarList points={p.task} unit="usd" label="Cost by task" emptyText="No activity" />
      </ChartCard>
      <ChartCard
        id="cb-model"
        title="By model"
        summary={`Estimated cost per model, ${c.label}`}
        rows={p.model}
        unit="usd"
      >
        <HBarList points={p.model} unit="usd" label="Cost by model" emptyText="No activity" />
      </ChartCard>
    </div>

    <div class="row">
      <ChartCard
        id="cb-project"
        title="By project"
        summary={`Estimated cost per project, ${c.label}`}
        rows={p.project}
        unit="usd"
      >
        <HBarList points={p.project} unit="usd" label="Cost by project" emptyText="No activity" />
      </ChartCard>
      <ChartCard
        id="cb-branch"
        title="By git branch"
        summary={`Estimated cost per git branch, ${c.label}`}
        rows={p.branch}
        unit="usd"
      >
        <HBarList points={p.branch} unit="usd" label="Cost by branch" emptyText="No activity" />
      </ChartCard>
      <ChartCard
        id="cb-tools"
        title="Tools"
        summary={`Tool calls, ${c.label}`}
        rows={p.tool}
        unit="count"
      >
        <HBarList points={p.tool} unit="count" label="Tool calls" emptyText="No tool calls" />
      </ChartCard>
    </div>

    <p class="footnote">
      Dollar figures are API-equivalent estimates, not what a subscription bills.
    </p>
  {/snippet}
</Loader>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--sp-3);
  }

  .row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-3);
    align-items: start;
    margin-top: var(--sp-3);
  }

  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .row {
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

  .footnote {
    margin: var(--sp-3) 0 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
