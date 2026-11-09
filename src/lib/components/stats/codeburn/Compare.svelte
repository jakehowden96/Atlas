<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { CohortComparison, ModelCompareRow } from "../../../../types/codeburn-compare";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import Button from "../../ui/Button.svelte";
  import Select from "../../ui/Select.svelte";
  import SegmentedControl from "../../ui/SegmentedControl.svelte";
  import Card from "./Card.svelte";
  import { cohortRows, metricsOf, modelStats, verdict, win } from "./compare-derive";
  import Loader from "./Loader.svelte";

  let { filters, refresh, preselect = "" }: { filters: Filters; refresh: number; preselect?: string } = $props();

  let tab = $state<"classic" | "cohorts">("classic");
  let by = $state<"category" | "project">("category");
  // Compare remounts on each tab switch, so the initial value is all that is needed.
  // svelte-ignore state_referenced_locally
  let pickA = $state<string | undefined>(preselect || undefined);
  let pickB = $state<string>();

  type M = ReturnType<typeof metricsOf>;
  /** dir 1: higher is better, -1: lower is better, 0: never highlighted. */
  interface Row {
    label: string;
    get: (r: ModelCompareRow, m: M) => number | null;
    dir: 1 | -1 | 0;
    fmt: (v: number) => string;
  }
  const p0 = (v: number) => `${Math.round(v)}%`;
  const d2 = (v: number) => fmtCost(v);
  const n2 = (v: number) => v.toFixed(2);
  // Delegation, planning, tools/turn and fast mode are not in codeburn compare: always "—".
  const none = () => null;

  const performance: Row[] = [
    { label: "One-shot rate", get: (_r, m) => m.oneShot, dir: 1, fmt: p0 },
    { label: "Retry rate", get: (_r, m) => m.retry, dir: -1, fmt: n2 },
    { label: "Self-correction", get: (_r, m) => m.selfCorr, dir: -1, fmt: (v) => `${Math.floor(v)}%` },
  ];
  const efficiency: Row[] = [
    { label: "Cost / call", get: (_r, m) => m.costPerCall, dir: -1, fmt: d2 },
    { label: "Cost / edit", get: (_r, m) => m.costPerEdit, dir: -1, fmt: d2 },
    { label: "Output tok / call", get: (_r, m) => m.outPerCall, dir: -1, fmt: (v) => String(Math.round(v)) },
    { label: "Cache hit rate", get: (_r, m) => m.cache, dir: 1, fmt: p0 },
  ];
  const style: Row[] = ["Delegation rate", "Planning rate", "Avg tools / turn", "Fast mode usage"].map(
    (label) => ({ label, get: none, dir: 0, fmt: String }),
  );
  const context: Row[] = [
    { label: "Calls", get: (r) => r.calls, dir: 0, fmt: fmtCount },
    { label: "Total cost", get: (r) => r.cost, dir: 0, fmt: d2 },
    { label: "Input tokens", get: (r) => r.inputTokens, dir: 0, fmt: fmtTokens },
    { label: "Output tokens", get: (r) => r.outputTokens, dir: 0, fmt: fmtTokens },
    { label: "Edit turns", get: (r) => r.editTurns, dir: 0, fmt: String },
    { label: "Self-corrections", get: (r) => r.selfCorrections, dir: 0, fmt: String },
    { label: "Cache hit rate", get: (_r, m) => m.cache, dir: 0, fmt: p0 },
    { label: "Days of data", get: (_r, m) => m.days, dir: 0, fmt: String },
  ];
</script>

{#snippet metricTable(rows: Row[], a: ModelCompareRow, b: ModelCompareRow, foot: boolean)}
  <table class="cb-table">
    <thead>
      <tr><th>Metric</th><th class="num">{a.model}</th><th class="num">{b.model}</th></tr>
    </thead>
    <tbody>
      {#each rows as r (r.label)}
        {@const x = r.get(a, metricsOf(a))}
        {@const y = r.get(b, metricsOf(b))}
        {@const w = r.dir ? win(x, y, r.dir) : 0}
        <tr>
          <td>{r.label}</td>
          <td class="num" class:good={w > 0}>{x === null ? "—" : r.fmt(x)}</td>
          <td class="num" class:good={w < 0}>{y === null ? "—" : r.fmt(y)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if foot}<p class="foot">Green = better on that metric. Ties are not highlighted.</p>{/if}
{/snippet}

<Loader args={["compare", "--format", "json", ...filterArgs(filters, "compare")]} {refresh}>
  {#snippet children(models: ModelCompareRow[])}
    {@const byCost = modelStats(models)}
    {@const A = pickA ?? byCost[0]?.model}
    {@const B = pickB ?? byCost[1]?.model}
    {@const a = models.find((m) => m.model === A)}
    {@const b = models.find((m) => m.model === B)}
    {@const opts = byCost.map((s) => ({ id: s.model, label: `${s.model} · ${fmtCount(s.calls)} calls` }))}
    <div class="page">
      {#if byCost.length < 2}
        <p class="note">Need activity from at least two models in this period to compare.</p>
      {:else}
        <SegmentedControl
          size="sm"
          label="Compare view"
          options={[
            { id: "classic", label: "Classic" },
            { id: "cohorts", label: "Cohorts" },
          ]}
          value={tab}
          onChange={(id) => (tab = id)}
        />
        <div class="pick">
          <Select options={opts} value={A} onChange={(id) => (pickA = id)} size="sm" aria-label="Model A" />
          <Button size="sm" aria-label="Swap models" onclick={() => ([pickA, pickB] = [B, A])}>⇄</Button>
          <Select options={opts} value={B} onChange={(id) => (pickB = id)} size="sm" aria-label="Model B" />
        </div>
        {#if a && b && a !== b}
          {@const text = verdict(a, b)}
          {#if text}<div class="banner">{text}</div>{/if}

          {#if tab === "classic"}
            <div class="two">
              <Card title="Performance">{@render metricTable(performance, a, b, true)}</Card>
              <Card title="Efficiency">{@render metricTable(efficiency, a, b, true)}</Card>
            </div>
            <Loader
              args={["compare", "--format", "cohort-json", "--model-a", a.model, "--model-b", b.model, ...filterArgs(filters, "compare")]}
              {refresh}
            >
              {#snippet children(c: CohortComparison)}
                {@const rows = cohortRows(c.modelA.observations, c.modelB.observations, "category")}
                <Card title="Category head-to-head" note="One-shot rate · edit turns">
                  <ul class="legend">
                    <li><i class="a"></i>{a.model}</li>
                    <li><i class="b"></i>{b.model}</li>
                  </ul>
                  {#each rows as r (r.key)}
                    <div class="cat">
                      <b>{r.key}</b>
                      {#each [["a", r.a], ["b", r.b]] as const as [side, v] (side)}
                        <div class="bar" class:low={v.n < 10}>
                          <span class="track">
                            <span class={`fill ${side}`} style:width={`${v.rate ?? 0}%`}></span>
                          </span>
                          <span class="mono">{v.rate === null ? "—" : `${Math.round(v.rate)}% (${v.n})`}</span>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <p class="note">No categorised edit turns.</p>
                  {/each}
                  <p class="foot">Faded rows have fewer than 10 edit turns.</p>
                </Card>
              {/snippet}
            </Loader>
            <div class="two">
              <Card title="Working style">{@render metricTable(style, a, b, false)}</Card>
              <Card title="Context">{@render metricTable(context, a, b, false)}</Card>
            </div>
          {:else}
            <Loader
              args={["compare", "--format", "cohort-json", "--model-a", a.model, "--model-b", b.model, ...filterArgs(filters, "compare")]}
              {refresh}
            >
              {#snippet children(c: CohortComparison)}
                {@const rows = cohortRows(c.modelA.observations, c.modelB.observations, by)}
                {@const low = rows.filter((r) => r.minN < 10).length}
                <Card title="Matched cohorts" note={`cost / edit · same ${by === "category" ? "task type" : "project"} for both models`}>
                  <SegmentedControl
                    size="sm"
                    role="radiogroup"
                    label="Cohort basis"
                    options={[
                      { id: "category", label: "By task" },
                      { id: "project", label: "By project" },
                    ]}
                    value={by}
                    onChange={(id) => (by = id)}
                  />
                  <table class="cb-table">
                    <thead>
                      <tr><th>Cohort</th><th class="num">{a.model}</th><th class="num">{b.model}</th><th class="num">Min n</th></tr>
                    </thead>
                    <tbody>
                      {#each rows as r (r.key)}
                        {@const w = win(r.a.cost, r.b.cost, -1)}
                        <tr>
                          <td>{r.key}</td>
                          <td class="num" class:good={w > 0}>{r.a.cost === null ? "—" : fmtCost(r.a.cost)} <span class="muted">n={r.a.n}</span></td>
                          <td class="num" class:good={w < 0}>{r.b.cost === null ? "—" : fmtCost(r.b.cost)} <span class="muted">n={r.b.n}</span></td>
                          <td class="num">{#if r.minN < 10}<span class="pill">low sample</span> {/if}{r.minN}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  <p class="foot">
                    {low
                      ? `${low} of ${rows.length} cohorts have fewer than 10 samples on one side: directional only.`
                      : "All cohorts have 10 or more samples per side."}
                  </p>
                </Card>
              {/snippet}
            </Loader>
          {/if}
        {/if}
      {/if}
    </div>
  {/snippet}
</Loader>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .banner {
    padding: var(--sp-3) var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    font-size: var(--fs-sm);
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-4);
    align-items: start;
  }
  .good {
    color: var(--accent);
    font-weight: var(--fw-semi);
  }
  .foot,
  .note,
  .muted {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .foot {
    margin: var(--sp-3) 0 0;
  }
  .pill {
    padding: 0 var(--sp-2);
    border: 1px solid var(--warn);
    border-radius: var(--r-pill);
    color: var(--warn);
    font-size: var(--fs-2xs);
  }
  .legend {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-4);
    margin: 0 0 var(--sp-3);
    padding: 0;
    list-style: none;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .legend i {
    display: inline-block;
    width: var(--sp-4);
    height: 3px;
    margin-right: var(--sp-2);
    vertical-align: middle;
  }
  i.a,
  .fill.a {
    background: var(--warn);
  }
  i.b,
  .fill.b {
    background: var(--text);
  }
  .cat {
    display: grid;
    grid-template-columns: 7rem 1fr;
    align-items: center;
    column-gap: var(--sp-3);
    padding: var(--sp-2) 0;
  }
  .cat b {
    grid-row: span 2;
    font-size: var(--fs-xs);
  }
  .bar {
    display: grid;
    grid-template-columns: 1fr 5rem;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-2xs);
  }
  .bar.low {
    opacity: 0.45;
  }
  .track {
    height: 3px;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: var(--r-xs);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
