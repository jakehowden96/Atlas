<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { SpendBranches, SpendFlow } from "../../../../types/codeburn-spend";
  import type { Point } from "../../../stats-chart";
  import { fmtCost } from "../../../stats-derive";
  import { statsFilters } from "../../../stores/statsFilters";
  import { tooltip } from "../../../ui/tooltip";
  import ChartCard from "../charts/ChartCard.svelte";
  import HBarList from "../charts/HBarList.svelte";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  const BRANCHES = 15;

  interface Daily {
    daily: { date: string; cost: number }[];
  }

  /** Drill: a project row narrows every page to that project. "Other" is a bucket, not a project. */
  function drill(flow: SpendFlow, key: string) {
    const label = flow.projects.find((p) => p.id === key)?.label;
    if (label && key !== "__other__") statsFilters.update((f) => ({ ...f, project: label }));
  }

  function flowPoints(d: SpendFlow): Point[] {
    const label = new Map([...d.models, ...d.projects].map((x) => [x.id, x.label]));
    return [...d.links]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 15)
      .map((l) => ({
        key: `${l.model}>${l.project}`,
        label: `${label.get(l.model) ?? l.model} → ${label.get(l.project) ?? l.project}`,
        value: l.cost,
      }));
  }

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

<Loader args={["report", "--format", "json", ...filterArgs(filters, "report")]} {refresh}>
  {#snippet children(r: Daily)}
    {@const peak = Math.max(...r.daily.map((d) => d.cost), 0)}
    <div class="card">
      <h3>Daily spend</h3>
      {#if peak === 0}
        <p class="note">No spend in this period.</p>
      {:else}
        <div class="days" role="group" aria-label="Daily spend">
          {#each r.daily as d (d.date)}
            <span
              class="day"
              role="img"
              aria-label={`${d.date}: ${fmtCost(d.cost)}`}
              use:tooltip={{ text: `${d.date}: ${fmtCost(d.cost)}`, delay: 0, side: "top" }}
            >
              <i style:height={`${(d.cost / peak) * 100}%`}></i>
            </span>
          {/each}
        </div>
        <p class="note">Peak day {fmtCost(peak)}</p>
      {/if}
    </div>
  {/snippet}
</Loader>

<Loader args={["spend", "--format", "flow-json", ...filterArgs(filters, "spend")]} {refresh}>
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
        <HBarList
          points={project}
          unit="usd"
          label="Cost by project (select to filter)"
          emptyText="No spend"
          onselect={(k) => drill(flow, k)}
        />
      </ChartCard>
    </div>
    {@const links = flowPoints(flow)}
    <div class="row">
      <ChartCard
        id="cb-spend-flow"
        title="Cost flow, model to project"
        summary={`Largest model to project flows, ${flow.period.label}`}
        rows={links}
        unit="usd"
      >
        <HBarList points={links} unit="usd" label="Model to project flow" emptyText="No spend" />
      </ChartCard>
      <div class="card">
        <h3>Spend punchcard</h3>
        <p class="note">— codeburn has no hour-of-day breakdown.</p>
      </div>
    </div>
  {/snippet}
</Loader>

<Loader args={["spend", "--format", "branch-json", ...filterArgs(filters, "spend")]} {refresh}>
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
  .card {
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  h3 {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-sm);
  }
  .note {
    margin: var(--sp-2) 0 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .days {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 120px;
  }
  .day {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .day i {
    display: block;
    width: 100%;
    min-height: 1px;
    background: var(--accent);
    border-radius: var(--r-xs) var(--r-xs) 0 0;
  }
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
