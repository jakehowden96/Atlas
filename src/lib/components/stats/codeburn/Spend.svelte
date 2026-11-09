<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { SpendBranches, SpendFlow } from "../../../../types/codeburn-spend";
  import { fmtCost } from "../../../stats-derive";
  import { statsFilters } from "../../../stores/statsFilters";
  import Select from "../../ui/Select.svelte";
  import DailyBars from "../charts/DailyBars.svelte";
  import RankList, { type RankItem } from "../charts/RankList.svelte";
  import Sankey from "../charts/Sankey.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import type { TrendDay } from "./overview-derive";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  const SHOWN = 5;
  const OTHER = "__other__";

  interface Report {
    daily: { date: string; cost: number }[];
    activities?: { category: string; cost: number; turns: number }[];
    tools?: { name: string; calls: number }[];
    mcpServers?: { name: string; calls: number }[];
    subagents?: { name: string; calls: number; cost: number }[];
  }

  let branchProject = $state<string | undefined>();

  const n = (v: number) => v.toLocaleString();
  const shortDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  /** Drill: a project row narrows every page to that project. "Other" is a bucket, not a project. */
  function drill(flow: SpendFlow, key: string) {
    const label = flow.projects.find((p) => p.id === key)?.label;
    if (label && key !== OTHER) statsFilters.update((f) => ({ ...f, project: label }));
  }

  const projectRows = (flow: SpendFlow): RankItem[] =>
    flow.projects
      .filter((p) => p.id !== OTHER)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, SHOWN)
      .map((p) => ({ key: p.id, title: p.label, value: fmtCost(p.cost) }));

  function branchRows(d: SpendBranches, id: string | undefined): RankItem[] {
    const p = d.projects.find((x) => x.id === id) ?? d.projects[0];
    return [...(p?.branches ?? [])]
      .sort((a, b) => b.cost - a.cost)
      .map((b) => ({
        key: b.branch,
        title: b.branch,
        sub: `${n(b.sessions)} sessions · ${n(b.calls)} calls`,
        value: fmtCost(b.cost),
      }));
  }
</script>

<Loader args={["report", "--format", "json", ...filterArgs(filters, "report")]} {refresh}>
  {#snippet children(r: Report)}
    {@const days = r.daily.map<TrendDay>((d) => ({
      key: d.date,
      label: shortDay(d.date),
      total: d.cost,
      parts: {},
    }))}
    <div class="stack">
      <div class="row">
        <Card title="Daily spend by model">
          <!-- Per-model split needs the timeline; report has daily totals only, so one series. -->
          <DailyBars {days} unit="usd" label="Daily spend" />
        </Card>
        {@render projects()}
      </div>
      {@render branches()}
      {@render flowCard()}
      <Card title="Spend punchcard">
        <p class="note">
          Hour-of-day detail needs sub-daily buckets. Switch to Today or 7D to see the punchcard.
        </p>
      </Card>
      <div class="row">
        <Card title="Activity">
          <div class="scroll">
            <RankList
              label="Activity"
              emptyText="—"
              items={(r.activities ?? []).map((a) => ({
                key: a.category,
                title: a.category,
                sub: `${n(a.turns)} turns`,
                value: fmtCost(a.cost),
              }))}
            />
          </div>
        </Card>
        <Card title="Tools">
          <div class="scroll">
            <RankList
              label="Tools"
              emptyText="—"
              items={(r.tools ?? []).map((t) => ({
                key: t.name,
                title: t.name,
                sub: `${n(t.calls)} calls`,
                value: "",
              }))}
            />
          </div>
        </Card>
      </div>
      <div class="row">
        <Card title="MCP servers">
          <div class="scroll">
            <RankList
              label="MCP servers"
              emptyText="—"
              items={(r.mcpServers ?? []).map((m) => ({
                key: m.name,
                title: m.name,
                sub: `${n(m.calls)} calls`,
                value: "",
              }))}
            />
          </div>
        </Card>
        <Card title="Subagents">
          <div class="scroll">
            <RankList
              label="Subagents"
              emptyText="—"
              items={(r.subagents ?? []).map((s) => ({
                key: s.name,
                title: s.name,
                sub: `${n(s.calls)} calls`,
                value: fmtCost(s.cost),
              }))}
            />
          </div>
        </Card>
      </div>
    </div>
  {/snippet}
</Loader>

{#snippet projects()}
  <Loader args={["spend", "--format", "flow-json", ...filterArgs(filters, "spend")]} {refresh}>
    {#snippet children(flow: SpendFlow)}
      <Card title="By project" note="Top {SHOWN}">
        <RankList
          label="Cost by project (select to filter)"
          emptyText="No spend"
          items={projectRows(flow)}
          onselect={(k) => drill(flow, k)}
        />
      </Card>
    {/snippet}
  </Loader>
{/snippet}

{#snippet branches()}
  <Loader args={["spend", "--format", "branch-json", ...filterArgs(filters, "spend")]} {refresh}>
    {#snippet children(d: SpendBranches)}
      {@const current = d.projects.find((p) => p.id === branchProject)?.id ?? d.projects[0]?.id}
      <Card title="By branch">
        {#if d.projects.length > 1}
          <div class="pick">
            <Select
              size="sm"
              aria-label="Project"
              options={d.projects.map((p) => ({ id: p.id, label: p.label }))}
              value={current}
              onChange={(id) => (branchProject = id)}
            />
          </div>
        {/if}
        <RankList label="Cost by branch" emptyText="No branch data" items={branchRows(d, current)} />
        <p class="note">
          A session that switched branches appears on each one, so rows are not summed.
        </p>
      </Card>
    {/snippet}
  </Loader>
{/snippet}

{#snippet flowCard()}
  <Loader args={["spend", "--format", "flow-json", ...filterArgs(filters, "spend")]} {refresh}>
    {#snippet children(flow: SpendFlow)}
      <Card title="Cost flow · model → project">
        <Sankey {flow} />
      </Card>
    {/snippet}
  </Loader>
{/snippet}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-4);
    align-items: start;
  }
  .scroll {
    max-height: 240px;
    overflow-y: auto;
  }
  .pick {
    margin-bottom: var(--sp-3);
  }
  .note {
    margin: var(--sp-3) 0 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  @media (max-width: 1100px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
