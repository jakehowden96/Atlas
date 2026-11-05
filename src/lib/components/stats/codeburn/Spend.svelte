<script lang="ts">
  import type { Period } from "../../../../types/codeburn";
  import type { SpendBranches, SpendFlow } from "../../../../types/codeburn-spend";
  import type { Point } from "../../../stats-chart";
  import ChartCard from "../charts/ChartCard.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Loader from "./Loader.svelte";

  let { period, refresh }: { period: Period; refresh: number } = $props();

  const BRANCHES = 15;

  const pts = (xs: { id: string; label: string; cost: number }[]): Point[] =>
    xs.map((x) => ({ key: x.id, label: x.label, value: x.cost }));

  function branchPoints(d: SpendBranches): Point[] {
    return d.projects
      .flatMap((p) =>
        p.branches.map((b) => ({
          key: `${p.id}:${b.branch}`,
          label: `${p.label} / ${b.branch}`,
          value: b.cost,
          context: `${b.sessions} sessions, ${b.calls} calls`,
        })),
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, BRANCHES);
  }
</script>

<Loader args={["spend", "--format", "flow-json", "--period", period]} {refresh}>
  {#snippet children(flow: SpendFlow)}
    {@const model = pts(flow.models)}
    {@const project = pts(flow.projects)}
    <div class="row">
      <ChartCard
        id="cb-spend-model"
        title="By model"
        summary={`Estimated cost per model, ${flow.period.label}`}
        rows={model}
        unit="usd"
      >
        <HBarList points={model} unit="usd" label="Cost by model" emptyText="No spend" />
      </ChartCard>
      <ChartCard
        id="cb-spend-project"
        title="By project"
        summary={`Estimated cost per project, ${flow.period.label}`}
        rows={project}
        unit="usd"
      >
        <HBarList points={project} unit="usd" label="Cost by project" emptyText="No spend" />
      </ChartCard>
    </div>
  {/snippet}
</Loader>

<Loader args={["spend", "--format", "branch-json", "--period", period]} {refresh}>
  {#snippet children(branches: SpendBranches)}
    {@const b = branchPoints(branches)}
    <div class="row">
      <ChartCard
        id="cb-spend-branch"
        title="By project and branch"
        summary={`Top ${BRANCHES} branches by estimated cost, ${branches.period.label}`}
        rows={b}
        unit="usd"
      >
        <HBarList points={b} unit="usd" label="Cost by branch" emptyText="No spend" />
      </ChartCard>
    </div>
  {/snippet}
</Loader>

<style>
  .row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-3);
    align-items: start;
    margin-top: var(--sp-3);
  }

  @media (max-width: 1100px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
