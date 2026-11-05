<script lang="ts">
  import type { Period } from "../../../../types/codeburn";
  import type { PullRequests } from "../../../../types/codeburn-prs";
  import type { Point } from "../../../stats-chart";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import ChartCard from "../charts/ChartCard.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";

  let { period, refresh }: { period: Period; refresh: number } = $props();

  function points(d: PullRequests): Point[] {
    return d.prs.map((p) => ({
      key: p.url,
      label: p.label,
      value: p.cost,
      context: `${p.state ?? "open"}, ${fmtCount(p.sessions)} sessions`,
    }));
  }
</script>

<Loader args={["sessions", "--by-pr", "--format", "json", "--period", period]} {refresh}>
  {#snippet children(d: PullRequests)}
    {@const rows = points(d)}
    <div class="kpis">
      <div class="card"><Kpi label="Pull requests" value={fmtCount(d.prs.length)} /></div>
      <div class="card"><Kpi label="Total cost" value={fmtCost(d.distinct.cost)} /></div>
      <div class="card">
        <Kpi label="Attributed to a PR" value={fmtCost(d.distinct.attributedCost)} />
      </div>
      <div class="card">
        <Kpi label="Unattributed" value={fmtCost(d.distinct.unattributedCost)} />
      </div>
    </div>

    <div class="row">
      <ChartCard
        id="cb-prs"
        title="Cost by pull request"
        summary="Estimated cost per pull request"
        {rows}
        unit="usd"
      >
        <HBarList points={rows} unit="usd" label="Cost by pull request" emptyText="No pull requests" />
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
