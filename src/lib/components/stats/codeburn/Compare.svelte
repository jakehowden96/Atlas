<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { CohortComparison, ModelCompareRow } from "../../../../types/codeburn-compare";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import { tooltip } from "../../../ui/tooltip";
  import Button from "../../ui/Button.svelte";
  import Select from "../../ui/Select.svelte";
  import SegmentedControl from "../../ui/SegmentedControl.svelte";
  import Card from "./Card.svelte";
  import { cohortRows, metricsOf, modelColor, modelStats, verdict, win } from "./compare-derive";
  import Loader from "./Loader.svelte";

  let { filters, refresh, preselect = "" }: { filters: Filters; refresh: number; preselect?: string } = $props();

  let tab = $state<"classic" | "cohorts">("classic");
  let by = $state<"category" | "project">("category");
  // Compare remounts on each tab switch, so the initial value is all that is needed.
  // svelte-ignore state_referenced_locally
  let pickA = $state<string | undefined>(preselect || undefined);
  let pickB = $state<string>();
  /** Head-to-head legend hover: 0 = model A, 1 = model B; the other fades. */
  let only = $state<0 | 1 | null>(null);

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

{#snippet dotted(model: string, color: string)}
  <span class="dot" style:background={color}></span>{model}
{/snippet}

{#snippet metricTable(rows: Row[], a: ModelCompareRow, b: ModelCompareRow, ca: string, cb: string, foot: boolean)}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th class="num">{@render dotted(a.model, ca)}</th>
          <th class="num">{@render dotted(b.model, cb)}</th>
        </tr>
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
  </div>
  {#if foot}<p class="foot">Green = better on that metric. Ties are not highlighted.</p>{/if}
{/snippet}

<Loader args={["compare", "--format", "json", ...filterArgs(filters, "compare")]} {refresh}>
  {#snippet children(models: ModelCompareRow[])}
    {@const byCost = modelStats(models)}
    {@const names = byCost.map((s) => s.model)}
    {@const A = pickA ?? byCost[0]?.model}
    {@const B = pickB ?? byCost[1]?.model}
    {@const a = models.find((m) => m.model === A)}
    {@const b = models.find((m) => m.model === B)}
    {@const ca = modelColor(A ?? "", names)}
    {@const cb = modelColor(B ?? "", names)}
    {@const opts = byCost.map((s) => ({ id: s.model, label: `${s.model} · ${fmtCount(s.calls)} calls` }))}
    <div class="page">
      {#if byCost.length < 2}
        <p class="empty">Need activity from at least two models in this period to compare.</p>
      {:else}
        <div class="bar">
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
        </div>
        <div class="bar">
          <div class="sel"><Select options={opts} value={A} onChange={(id) => (pickA = id)} size="sm" aria-label="Model A" /></div>
          <Button size="sm" aria-label="Swap models" onclick={() => ([pickA, pickB] = [B, A])}>⇄</Button>
          <div class="sel"><Select options={opts} value={B} onChange={(id) => (pickB = id)} size="sm" aria-label="Model B" /></div>
        </div>
        {#if a && b && a !== b}
          {@const text = verdict(a, b)}
          {#if text}
            <section class="banner">
              <span class="muted">⇄</span>
              <span>{text}</span>
            </section>
          {/if}

          {#if tab === "classic"}
            <div class="two">
              <Card title="Performance">{@render metricTable(performance, a, b, ca, cb, true)}</Card>
              <Card title="Efficiency">{@render metricTable(efficiency, a, b, ca, cb, true)}</Card>
            </div>
            <Loader
              args={["compare", "--format", "cohort-json", "--model-a", a.model, "--model-b", b.model, ...filterArgs(filters, "compare")]}
              {refresh}
            >
              {#snippet children(c: CohortComparison)}
                {@const rows = cohortRows(c.modelA.observations, c.modelB.observations, "category")}
                <Card title="Category head-to-head" note="One-shot rate · edit turns">
                  <ul class="legend">
                    <li onpointerenter={() => (only = 0)} onpointerleave={() => (only = null)}><span class="dot" style:background={ca}></span>{a.model}</li>
                    <li onpointerenter={() => (only = 1)} onpointerleave={() => (only = null)}><span class="dot" style:background={cb}></span>{b.model}</li>
                  </ul>
                  {#each rows as r (r.key)}
                    {@const w = win(r.a.rate, r.b.rate, 1)}
                    <div class="cat">
                      <b>{r.key}</b>
                      {#each [[r.a, ca, w > 0, a.model], [r.b, cb, w < 0, b.model]] as const as [v, color, good, name], i (i)}
                        <div
                          class="cmp"
                          class:low={v.n < 10}
                          class:fade={only !== null && only !== i}
                          use:tooltip={{
                            text: `${name}: ${v.rate === null ? "—" : `${Math.round(v.rate)}%`} one-shot over ${v.n} edit turns`,
                            delay: 0,
                            side: "top",
                          }}
                        >
                          <span class="track">
                            <span class="fill" style:width={`${v.rate ?? 0}%`} style:background={color}></span>
                          </span>
                          <span class="mono" class:good>{v.rate === null ? "—" : `${Math.round(v.rate)}% (${v.n})`}</span>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <p class="empty">No categorised edit turns.</p>
                  {/each}
                  <p class="foot">Faded rows have fewer than 10 edit turns.</p>
                </Card>
              {/snippet}
            </Loader>
            <div class="two">
              <Card title="Working style">{@render metricTable(style, a, b, ca, cb, false)}</Card>
              <Card title="Context">{@render metricTable(context, a, b, ca, cb, false)}</Card>
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
                  <div class="bar">
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
                  </div>
                  <div class="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Cohort</th>
                          <th class="num">{@render dotted(a.model, ca)}</th>
                          <th class="num">{@render dotted(b.model, cb)}</th>
                          <th class="num">Min n</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each rows as r (r.key)}
                          {@const w = win(r.a.cost, r.b.cost, -1)}
                          <tr>
                            <td>{r.key}</td>
                            <td class="num"><span class:good={w > 0}>{r.a.cost === null ? "—" : fmtCost(r.a.cost)}</span> <span class="muted">n={r.a.n}</span></td>
                            <td class="num"><span class:good={w < 0}>{r.b.cost === null ? "—" : fmtCost(r.b.cost)}</span> <span class="muted">n={r.b.n}</span></td>
                            <td class="num">{#if r.minN < 10}<span class="pill" use:tooltip={{ text: `n = ${r.a.n} vs ${r.b.n}` }}>low sample</span> {/if}{r.minN}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
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
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-4);
  }
  .sel {
    width: 220px;
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-5);
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
  @media (max-width: 860px) {
    .two {
      grid-template-columns: minmax(0, 1fr);
    }
  }
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
  th.num {
    text-align: right;
  }
  td.num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .dot {
    display: inline-block;
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-3);
    border-radius: 50%;
  }
  .good {
    color: var(--accent);
    font-weight: var(--fw-semi);
  }
  .foot,
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--sp-2) var(--sp-5);
    margin: 0 0 var(--sp-4);
    padding: 0;
    list-style: none;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .legend .dot {
    margin: 0;
  }
  .cat {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: center;
    row-gap: var(--sp-1);
    margin-bottom: var(--sp-4);
  }
  .cat b {
    grid-row: 1 / span 2;
    grid-column: 1;
    font-size: var(--fs-xs);
    font-weight: var(--fw-semi);
  }
  .cmp {
    display: grid;
    grid-column: 2;
    grid-template-columns: minmax(0, 1fr) 80px;
    gap: var(--sp-3);
    align-items: center;
    font-size: var(--fs-xs);
  }
  .cmp.low {
    opacity: 0.55;
  }
  .cmp.fade {
    opacity: 0.18;
  }
  .track {
    height: 6px;
    overflow: hidden;
    border-radius: var(--r-pill);
    background: var(--surface3);
  }
  .fill {
    display: block;
    height: 100%;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
