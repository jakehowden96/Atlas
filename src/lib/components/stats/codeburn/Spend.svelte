<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { SpendBranches, SpendFlow } from "../../../../types/codeburn-spend";
  import { fmtCost } from "../../../stats-derive";
  import { statsFilters } from "../../../stores/statsFilters";
  import Select from "../../ui/Select.svelte";
  import SpendChart from "../charts/SpendChart.svelte";
  import RankList, { type RankItem } from "../charts/RankList.svelte";
  import Sankey from "../charts/Sankey.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  const SHOWN = 5;
  const OTHER = "__other__";

  interface Report {
    daily: { date: string; cost: number }[];
    projects?: { name: string; sessions: number }[];
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
    if (label && key !== OTHER)
      statsFilters.update((f) => ({ ...f, project: f.project === label ? undefined : label }));
  }

  const plural = (v: number, w: string) => `${n(v)} ${w}${v === 1 ? "" : "s"}`;

  const projectRows = (flow: SpendFlow, r: Report): RankItem[] =>
    flow.projects
      .filter((p) => p.id !== OTHER)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, SHOWN)
      .map((p) => {
        const s = r.projects?.find((x) => x.name === p.label)?.sessions;
        return {
          key: p.id,
          title: p.label,
          sub: s == null ? undefined : `At least ${plural(s, "session")}`,
          value: fmtCost(p.cost),
        };
      });

  function branchRows(d: SpendBranches, id: string | undefined): RankItem[] {
    const p = d.projects.find((x) => x.id === id) ?? d.projects[0];
    return [...(p?.branches ?? [])]
      .sort((a, b) => b.cost - a.cost)
      .map((b) => ({
        key: b.branch,
        title: b.branch,
        sub: `${plural(b.sessions, "session")} · ${plural(b.calls, "call")}`,
        value: fmtCost(b.cost),
      }));
  }
</script>

<Loader args={["report", "--format", "json", ...filterArgs(filters, "report")]} {refresh}>
  {#snippet children(r: Report)}
    {@const days = r.daily.map((d) => ({ label: shortDay(d.date), total: d.cost }))}
    <div class="stack">
      <div class="row">
        <Card title="Daily spend by model">
          <!-- Per-model split needs the timeline; report has daily totals only, so one series. -->
          <SpendChart {days} />
        </Card>
        {@render projects(r)}
      </div>
      {@render branches(r)}
      {@render flowCard()}
      <Card title="Spend punchcard" note="hour of day × weekday">
        <p class="empty">
          Hour-of-day detail needs sub-daily buckets. Switch to Today or 7D to see the punchcard.
        </p>
      </Card>
      <div class="row">
        <Card title="Activity">
          <div class="sp-scroll">
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
          <div class="sp-scroll">
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
        <Card title="MCP">
          <div class="sp-scroll">
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
          <div class="sp-scroll">
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

{#snippet projects(r: Report)}
  <Loader args={["spend", "--format", "flow-json", ...filterArgs(filters, "spend")]} {refresh}>
    {#snippet children(flow: SpendFlow)}
      <Card
        title="By project"
        note={filters.project ? "filtered · click again to clear" : `top ${SHOWN}`}
      >
        <RankList
          label="Cost by project (select to filter)"
          emptyText="No spend"
          items={projectRows(flow, r)}
          active={flow.projects.find((p) => p.label === filters.project)?.id}
          onselect={(k) => drill(flow, k)}
        />
      </Card>
    {/snippet}
  </Loader>
{/snippet}

{#snippet branches(r: Report)}
  <Loader args={["spend", "--format", "branch-json", ...filterArgs(filters, "spend")]} {refresh}>
    {#snippet children(d: SpendBranches)}
      {@const current = d.projects.find((p) => p.id === branchProject)?.id ?? d.projects[0]?.id}
      <Card title="By branch" note="spend per project and branch">
        {#if d.projects.length > 1}
          <div class="pick">
            <Select
              size="sm"
              aria-label="Project"
              options={d.projects.map((p) => ({ id: p.id, label: `projects/${p.label}` }))}
              value={current}
              onChange={(id) => (branchProject = id)}
            />
          </div>
        {/if}
        <RankList
          label="Cost by branch"
          emptyText="No branch data"
          items={branchRows(d, current)}
        />
        {@const rows = d.projects.find((p) => p.id === current)?.branches ?? []}
        {@const nob = rows
          .filter((b) => b.branch === "(no branch)")
          .reduce((a, b) => a + b.cost, 0)}
        {@const lbl = d.projects.find((p) => p.id === current)?.label}
        {@const sess = r.projects?.find((p) => p.name === lbl)?.sessions}
        {@const total = rows.reduce((a, b) => a + b.cost, 0)}
        {#if rows.length > 0}
          <p class="note first">
            On branches {fmtCost(total - nob)} · Unknown, before first branch {fmtCost(0)} · No branch
            data {fmtCost(nob)}
          </p>
          <p class="note">
            {sess == null ? "—" : plural(sess, "distinct session")}. A session that switched
            branches appears on each one, so rows are not summed.
          </p>
        {/if}
      </Card>
    {/snippet}
  </Loader>
{/snippet}

{#snippet flowCard()}
  <Loader args={["spend", "--format", "flow-json", ...filterArgs(filters, "spend")]} {refresh}>
    {#snippet children(flow: SpendFlow)}
      <Card title="Cost flow · model → project" note="model → project flow for this range">
        <Sankey
          {flow}
          active={flow.projects.find((p) => p.label === filters.project)?.id}
          onselect={(k) => drill(flow, k)}
        />
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
  .sp-scroll {
    max-height: 264px;
    overflow-y: auto;
  }
  .pick {
    width: 240px;
    margin-bottom: var(--sp-3);
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .note.first {
    margin-top: var(--sp-3);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }

  @media (max-width: 1100px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
