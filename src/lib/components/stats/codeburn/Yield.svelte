<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { Yield, YieldCategory } from "../../../../types/codeburn-yield";
  import type { Point } from "../../../stats-chart";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import ChartCard from "../charts/ChartCard.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";
  import { yieldCosts } from "./yield-derive";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  const CATS: YieldCategory[] = ["productive", "reverted", "abandoned", "ambiguous"];

  function points(y: Yield): Point[] {
    return CATS.map((c) => ({
      key: c,
      label: c.charAt(0).toUpperCase() + c.slice(1),
      value: y.summary[c].costUSD,
      context: `${fmtCount(y.summary[c].sessions)} sessions, ${y.summary[c].costPercent}% of spend`,
    }));
  }

  const money = (v: number | null) => (v === null ? "n/a" : fmtCost(v));
</script>

<Loader args={["yield", "--format", "json", ...filterArgs(filters, "yield")]} {refresh}>
  {#snippet children(y: Yield)}
    {@const costs = yieldCosts(y)}
    {@const rows = points(y)}
    <div class="kpis">
      <div class="card"><Kpi label="Total spend" value={fmtCost(y.summary.total.costUSD)} /></div>
      <div class="card">
        <Kpi label="Productive spend" value={fmtCost(y.summary.productive.costUSD)} />
      </div>
      <div class="card"><Kpi label="Cost per commit" value={money(costs.perCommit)} /></div>
      <div class="card">
        <Kpi label="Cost per productive session" value={money(costs.perProductive)} />
      </div>
    </div>

    <div class="row">
      <ChartCard
        id="cb-yield"
        title="Spend by outcome"
        summary={`Estimated cost by session outcome, ${y.period.label}`}
        {rows}
        unit="usd"
      >
        <HBarList points={rows} unit="usd" label="Spend by outcome" emptyText="No activity" />
      </ChartCard>
    </div>

    <p class="footnote">
      Outcomes are inferred from git commits in each session time window. Dollar figures are
      API-equivalent estimates.
    </p>
  {/snippet}
</Loader>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-3);
  }

  .row {
    margin-top: var(--sp-3);
  }

  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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
