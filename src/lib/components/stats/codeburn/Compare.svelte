<script lang="ts">
  import type { Period } from "../../../../types/codeburn";
  import type {
    CohortComparison,
    ModelCompareRow,
    PeriodCompare,
    PeriodRow,
  } from "../../../../types/codeburn-compare";
  import type { Point } from "../../../stats-chart";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import ChartCard from "../charts/ChartCard.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Select from "../../ui/Select.svelte";
  import { modelStats, shortKey } from "./compare-derive";
  import Loader from "./Loader.svelte";

  let { period, refresh }: { period: Period; refresh: number } = $props();

  let a = $state("");
  let b = $state("");

  const pct = (v: number | null) => (v === null ? undefined : v);
  const rate = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  const cost = (v: number | null) => (v === null ? "n/a" : fmtCost(v));
  const rows = (r: PeriodRow[]): Point[] =>
    r.slice(0, 10).map((x) => ({
      key: x.key,
      label: shortKey(x.key),
      value: x.diff,
      context: `${fmtCost(x.costA)} to ${fmtCost(x.costB)}`,
    }));
</script>

<Loader args={["compare", "--format", "json", "--period", period]} {refresh}>
  {#snippet children(models: ModelCompareRow[])}
    {@const stats = modelStats(models)}
    {@const opts = stats.map((s) => ({ id: s.model, label: s.model }))}
    <table>
      <thead>
        <tr>
          <th>Model</th><th>Cost</th><th>Calls</th><th>Cost/call</th><th>One-shot</th><th>Retries</th>
        </tr>
      </thead>
      <tbody>
        {#each stats as s (s.model)}
          <tr>
            <td>{s.model}</td>
            <td>{fmtCost(s.cost)}</td>
            <td>{fmtCount(s.calls)}</td>
            <td>{fmtCost(s.costPerCall)}</td>
            <td>{rate(s.oneShotRate)}</td>
            <td>{fmtCount(s.retries)}</td>
          </tr>
        {:else}
          <tr><td colspan="6">No model activity in this period.</td></tr>
        {/each}
      </tbody>
    </table>

    {#if stats.length >= 2}
      <div class="pick">
        <Select options={opts} bind:value={a} placeholder="Model A" size="sm" aria-label="Model A" />
        <Select options={opts} bind:value={b} placeholder="Model B" size="sm" aria-label="Model B" />
      </div>
      {#if a && b && a !== b}
        <Loader
          args={["compare", "--format", "cohort-json", "--model-a", a, "--model-b", b]}
          {refresh}
        >
          {#snippet children(c: CohortComparison)}
            <div class="kpis">
              {#each [c.modelA, c.modelB] as m (m.model)}
                <div class="card">
                  <Kpi label={`${m.label} median cost`} value={cost(m.stats.costMedian)} />
                </div>
                <div class="card">
                  <Kpi label={`${m.label} one-shot`} value={`${Math.round(m.stats.oneShotRate)}%`} />
                </div>
                <div class="card">
                  <Kpi
                    label={`${m.label} retry rate`}
                    value={`${(m.stats.retryRate * 100).toFixed(1)}%`}
                  />
                </div>
              {/each}
            </div>
          {/snippet}
        </Loader>
      {/if}
    {/if}
  {/snippet}
</Loader>

<h3>Last 7 days vs the 7 before</h3>
<Loader args={["compare-periods", "--format", "json"]} {refresh}>
  {#snippet children(p: PeriodCompare)}
    <div class="kpis">
      <div class="card">
        <Kpi
          label="Cost"
          value={fmtCost(p.totals.B.cost)}
          delta={pct(p.totals.pct.cost)}
          versus="previous"
        />
      </div>
      <div class="card">
        <Kpi
          label="Calls"
          value={fmtCount(p.totals.B.calls)}
          delta={pct(p.totals.pct.calls)}
          versus="previous"
        />
      </div>
      <div class="card">
        <Kpi
          label="Sessions"
          value={fmtCount(p.totals.B.sessions)}
          delta={pct(p.totals.pct.sessions)}
          versus="previous"
        />
      </div>
    </div>
    <div class="row">
      <ChartCard
        id="cb-cmp-project"
        title="Project change"
        summary="Cost change per project"
        rows={rows(p.projects)}
        unit="usd"
      >
        <HBarList
          points={rows(p.projects)}
          unit="usd"
          label="Project cost change"
          emptyText="No projects"
        />
      </ChartCard>
      <ChartCard
        id="cb-cmp-model"
        title="Model change"
        summary="Cost change per model"
        rows={rows(p.models)}
        unit="usd"
      >
        <HBarList
          points={rows(p.models)}
          unit="usd"
          label="Model cost change"
          emptyText="No models"
        />
      </ChartCard>
    </div>
  {/snippet}
</Loader>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--sp-1) var(--sp-2);
  }
  .pick {
    display: flex;
    gap: var(--sp-3);
    margin: var(--sp-3) 0;
  }
  .kpis,
  .row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }
  .row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
  h3 {
    margin: var(--sp-4) 0 0;
  }
</style>
