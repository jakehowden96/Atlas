<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PeriodCompare, PeriodTotals } from "../../../../types/codeburn-compare";
  import { niceTicks } from "../../../stats-chart";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import { tooltip } from "../../../ui/tooltip";
  import Button from "../../ui/Button.svelte";
  import Input from "../../ui/Input.svelte";
  import SegmentedControl from "../../ui/SegmentedControl.svelte";
  import Card from "./Card.svelte";
  import { dayPairs, movers, presetRanges, type Basis } from "./compare-periods-derive";
  import Loader from "./Loader.svelte";
  import "./table.css";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  interface Daily {
    daily: { date: string; cost: number }[];
  }

  const PREVIEW = 8;
  let mode = $state<"preset" | "custom">("preset");
  let r = $state(presetRanges(new Date()));
  let by = $state<"projects" | "models">("projects");
  let basis = $state<Basis>("raw");
  let all = $state(false);

  const valid = $derived(
    [r.a0, r.a1, r.b0, r.b1].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && r.a0 <= r.a1 && r.b0 <= r.b1,
  );
  const fl = $derived(filterArgs(filters, "compare-periods"));

  function setMode(m: "preset" | "custom") {
    mode = m;
    if (m === "preset") r = presetRanges(new Date());
  }
  function swap() {
    mode = "custom";
    r = { a0: r.b0, a1: r.b1, b0: r.a0, b1: r.a1 };
  }

  const window = (from: string, to: string) => ["--from", from, "--to", to];
  const short = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const span = (x: { from: string; to: string }) => `${short(x.from)} to ${short(x.to)}`;
  const per100 = (t: PeriodTotals) => (t.calls > 0 ? (t.cost / t.calls) * 100 : 0);
  const pctText = (p: number | null) => (p === null ? "" : `${p > 0 ? "+" : ""}${p.toFixed(0)}%`);
  const breakdown = (t: PeriodTotals) =>
    `Input ${fmtTokens(t.inputTokens)} · Output ${fmtTokens(t.outputTokens)} · Cache read ${fmtTokens(t.cacheReadTokens)} · Cache write ${fmtTokens(t.cacheWriteTokens)} · Calls ${fmtCount(t.calls)}`;
  const pctOf = (a: number, b: number) => (a > 0 ? ((b - a) / a) * 100 : null);
  const fmtBasis = (v: number) => (basis === "raw" ? fmtCost(v) : `${fmtCost(v)}${basis === "day" ? "/day" : "/100"}`);
</script>

<Card title="Compare periods">
  <div class="controls">
    <SegmentedControl
      role="radiogroup"
      size="sm"
      label="Period preset"
      value={mode}
      onChange={setMode}
      options={[
        { id: "preset", label: "Last 7 vs prior 7" },
        { id: "custom", label: "Custom" },
      ]}
    />
    <Button size="sm" onclick={swap}>Swap</Button>
  </div>
  <div class="ranges">
    <div>
      <span class="tag">A · Reference</span>
      {#if mode === "custom"}
        <Input type="date" aria-label="A from" bind:value={r.a0} />
        <Input type="date" aria-label="A to" bind:value={r.a1} />
      {/if}
    </div>
    <div>
      <span class="tag b">B · Analyzed</span>
      {#if mode === "custom"}
        <Input type="date" aria-label="B from" bind:value={r.b0} />
        <Input type="date" aria-label="B to" bind:value={r.b1} />
      {/if}
    </div>
  </div>
  {#if mode === "custom" && !valid}
    <p class="note">Enter all four dates, each window from earlier to later.</p>
  {/if}
</Card>

{#if valid}
  <Loader
    args={["compare-periods", "--format", "json", "--from-a", r.a0, "--to-a", r.a1, "--from-b", r.b0, "--to-b", r.b1, ...fl]}
    {refresh}
  >
    {#snippet children(p: PeriodCompare)}
      {@const A = p.totals.A}
      {@const B = p.totals.B}
      {@const pct = p.totals.pct.cost}
      {@const c100 = pctOf(per100(A), per100(B))}
      {@const sess = pctOf(A.sessions, B.sessions)}
      <p class="note">
        A spans {p.rangeA.days} days · B spans {p.rangeB.days} days · all differences are B − A
      </p>
      <Card title="Summary" note={`${span(p.rangeA)} vs ${span(p.rangeB)}`}>
        <p class="story">
          {#if pct === null}
            {B.cost > 0 ? `B cost ${fmtCost(B.cost)} and A had no spend.` : "No spend in either window."}
          {:else if pct === 0}
            B cost the same as A: {fmtCost(B.cost)} versus {fmtCost(A.cost)}.
          {:else}
            B ({span(p.rangeB)}) cost {Math.abs(pct).toFixed(0)}% {pct > 0 ? "more" : "less"} than A: {fmtCost(B.cost)}
            versus {fmtCost(A.cost)}.
          {/if}
        </p>
        <div class="kpis">
          <div class="kpi" use:tooltip={{ text: `B: ${breakdown(B)}`, delay: 0, side: "top" }}>
            <span class="k">Total cost</span>
            <strong>{fmtCost(B.cost)}</strong>
            <span class="d" class:up={(pct ?? 0) > 0} class:down={(pct ?? 0) < 0}>{pctText(pct)}</span>
          </div>
          <div class="kpi">
            <span class="k">Cost per 100 calls</span>
            <strong>{fmtCost(per100(B))}</strong>
            <span class="d" class:up={(c100 ?? 0) > 0} class:down={(c100 ?? 0) < 0}>{pctText(c100)}</span>
          </div>
          <div class="kpi">
            <span class="k">Sessions</span>
            <strong>{fmtCount(B.sessions)}</strong>
            <span class="d">{pctText(sess)}</span>
          </div>
        </div>
      </Card>

      <Loader args={["report", "--format", "json", ...window(p.rangeA.from, p.rangeA.to), ...fl]} {refresh}>
        {#snippet children(a: Daily)}
          <Loader args={["report", "--format", "json", ...window(p.rangeB.from, p.rangeB.to), ...fl]} {refresh}>
            {#snippet children(b: Daily)}
              {@const rows = dayPairs({ A: a.daily, B: b.daily }, p.rangeA.from, p.rangeB.from, Math.max(p.rangeA.days, p.rangeB.days))}
              {@const peak = Math.max(...rows.flatMap((x) => [x.a, x.b]), 0)}
              {@const ticks = niceTicks(peak)}
              {@const top = ticks[ticks.length - 1] || 1}
              <Card title="Compare days side by side">
                <p class="legend">
                  <span class="a">Week of {short(p.rangeA.from)}</span>
                  <span class="b">Week of {short(p.rangeB.from)}</span>
                </p>
                {#if peak === 0}
                  <p class="note">No spend in either window.</p>
                {:else}
                  <div class="chart-wrap">
                    <div class="chart" role="group" aria-label="Daily spend, window A against window B">
                      {#each rows as x (x.i)}
                        {@const text = `Day ${x.i + 1}: A ${fmtCost(x.a)}, B ${fmtCost(x.b)}`}
                        <span class="col" role="img" aria-label={text} use:tooltip={{ text, delay: 0, side: "top" }}>
                          <i class="a" style:height={`${(x.a / top) * 100}%`}></i>
                          <i class="b" style:height={`${(x.b / top) * 100}%`}></i>
                        </span>
                      {/each}
                      <div class="peak" style:bottom={`${(peak / top) * 100}%`}></div>
                    </div>
                    <div class="axis" aria-hidden="true">
                      {#each ticks as t (t)}
                        <span style:bottom={`${(t / top) * 100}%`}>{fmtCost(t)}</span>
                      {/each}
                    </div>
                  </div>
                  <p class="note">Each pair is one day of A beside the same-numbered day of B.</p>
                {/if}
              </Card>
            {/snippet}
          </Loader>
        {/snippet}
      </Loader>

      {@const list = movers(p[by], basis, p.rangeA.days, p.rangeB.days)}
      {@const shown = all ? list : list.slice(0, PREVIEW)}
      <Card title="What changed, biggest movers">
        <div class="controls">
          <SegmentedControl
            role="radiogroup"
            size="sm"
            label="Group by"
            value={by}
            onChange={(v) => (by = v)}
            options={[
              { id: "projects", label: "By project" },
              { id: "models", label: "By model" },
            ]}
          />
          <SegmentedControl
            role="radiogroup"
            size="sm"
            label="Basis"
            value={basis}
            onChange={(v) => (basis = v)}
            options={[
              { id: "raw", label: "Raw" },
              { id: "day", label: "Per day" },
              { id: "calls", label: "Per 100 calls" },
            ]}
          />
          {#if list.length > PREVIEW}
            <Button size="sm" variant="ghost" onclick={() => (all = !all)}>
              {all ? "Show fewer" : `Show all ${list.length}`}
            </Button>
          {/if}
        </div>
        {#if list.length === 0}
          <p class="note">Nothing to compare.</p>
        {:else}
          <table class="cb-table">
            <thead>
              <tr>
                <th>{by === "projects" ? "Project" : "Model"}</th>
                <th class="num">A · {span(p.rangeA)}</th>
                <th class="num">B · {span(p.rangeB)}</th>
                <th class="num">Change</th>
                <th class="num">%</th>
              </tr>
            </thead>
            <tbody>
              {#each shown as m (m.key)}
                <tr>
                  <td>{m.key}</td>
                  <td class="num">{fmtBasis(m.a)}</td>
                  <td class="num">{fmtBasis(m.b)}</td>
                  <td class="num d" class:up={m.diff > 0} class:down={m.diff < 0}>{m.diff > 0 ? "+" : ""}{fmtBasis(m.diff)}</td>
                  <td class="num d" class:up={m.diff > 0} class:down={m.diff < 0}>
                    {#if m.isNew}<span class="pill">new this period</span>{:else}{pctText(m.pct)}{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <p class="note">Change is B − A. Spend up is red, spend down is green.</p>
      </Card>

      <details>
        <summary>All metrics</summary>
        <table class="cb-table">
          <thead>
            <tr><th>Metric</th><th class="num">A</th><th class="num">B</th><th class="num">Change</th></tr>
          </thead>
          <tbody>
            {#each [["Cost", "cost"], ["Calls", "calls"], ["Sessions", "sessions"], ["Input tokens", "inputTokens"], ["Output tokens", "outputTokens"], ["Cache read tokens", "cacheReadTokens"], ["Cache write tokens", "cacheWriteTokens"]] as [label, k] (k)}
              {@const key = k as keyof PeriodTotals}
              {@const f = (v: number) => (key === "cost" ? fmtCost(v) : key.endsWith("Tokens") ? fmtTokens(v) : fmtCount(v))}
              <tr>
                <td>{label}</td>
                <td class="num">{f(A[key])}</td>
                <td class="num">{f(B[key])}</td>
                <td class="num">{pctText(p.totals.pct[key])}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
      <details>
        <summary>What is counted</summary>
        <p class="note">
          Spend and calls come from codeburn's local session logs for the chosen windows, filtered by the project and
          provider selected above. Windows are whole calendar days, both ends included.
        </p>
      </details>
    {/snippet}
  </Loader>
{/if}

<style>
  .controls,
  .ranges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-3);
  }
  .ranges > div {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .tag {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    text-transform: uppercase;
  }
  .tag.b {
    color: var(--accent);
  }
  .note {
    margin: var(--sp-2) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .story {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-sm);
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .k {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .kpi strong {
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
  }
  .d.up {
    color: var(--danger);
  }
  .d.down {
    color: var(--accent);
  }
  .pill {
    padding: 0 var(--sp-2);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    font-size: var(--fs-2xs);
  }
  .chart-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px;
    column-gap: var(--sp-3);
  }
  .chart {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: var(--sp-1);
    height: 160px;
    border-bottom: 1px solid var(--border);
  }
  .peak {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--border2);
    pointer-events: none;
  }
  .axis {
    position: relative;
  }
  .axis span {
    position: absolute;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    transform: translateY(50%);
  }
  .col {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
    gap: 1px;
  }
  .col i {
    flex: 1;
    min-height: 1px;
  }
  .col .a,
  .legend .a::before {
    background: var(--surface3);
  }
  .col .b,
  .legend .b::before {
    background: var(--accent);
  }
  .legend {
    display: flex;
    gap: var(--sp-4);
    margin: 0 0 var(--sp-3);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .legend span::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-1);
  }
  details {
    margin-top: var(--sp-3);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  summary {
    cursor: pointer;
  }
</style>
