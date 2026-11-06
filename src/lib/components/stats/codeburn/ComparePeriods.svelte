<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PeriodCompare } from "../../../../types/codeburn-compare";
  import { fmtCost } from "../../../stats-derive";
  import { tooltip } from "../../../ui/tooltip";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  interface Daily {
    daily: { date: string; cost: number }[];
  }

  const range = (r: { from: string; to: string }) => ["--from", r.from, "--to", r.to];

  /** Day i of each window, paired by offset from the window start. */
  function pairs(p: PeriodCompare, a: Daily, b: Daily) {
    const n = Math.max(p.rangeA.days, p.rangeB.days);
    const at = (d: Daily, from: string, i: number) => {
      const day = new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10);
      return d.daily.find((x) => x.date === day)?.cost ?? 0;
    };
    return Array.from({ length: n }, (_, i) => ({
      i,
      a: at(a, p.rangeA.from, i),
      b: at(b, p.rangeB.from, i),
    }));
  }
</script>

<Loader args={["compare-periods", "--format", "json", ...filterArgs(filters, "compare-periods")]} {refresh}>
  {#snippet children(p: PeriodCompare)}
    <Loader args={["report", "--format", "json", ...range(p.rangeA), ...filterArgs(filters, "compare-periods")]} {refresh}>
      {#snippet children(a: Daily)}
        <Loader args={["report", "--format", "json", ...range(p.rangeB), ...filterArgs(filters, "compare-periods")]} {refresh}>
          {#snippet children(b: Daily)}
            {@const rows = pairs(p, a, b)}
            {@const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 0.01)}
            {@const peak = Math.max(...rows.map((r) => r.b), 0)}
            <p class="legend">
              <span class="a">A {p.rangeA.from} to {p.rangeA.to}</span>
              <span class="b">B {p.rangeB.from} to {p.rangeB.to}</span>
              <span>Peak B day {peak > 0 ? fmtCost(peak) : "—"}</span>
            </p>
            {#if rows.every((r) => r.a === 0 && r.b === 0)}
              <p class="legend">No spend in either window.</p>
            {:else}
              <div class="chart" role="group" aria-label="Daily spend, window A against window B">
                {#each rows as r (r.i)}
                  {@const text = `Day ${r.i + 1}: A ${fmtCost(r.a)}, B ${fmtCost(r.b)}`}
                  <span class="col" role="img" aria-label={text} use:tooltip={{ text, delay: 0, side: "top" }}>
                    <i class="a" style:height={`${(r.a / max) * 100}%`}></i>
                    <i class="b" style:height={`${(r.b / max) * 100}%`}></i>
                  </span>
                {/each}
              </div>
            {/if}
          {/snippet}
        </Loader>
      {/snippet}
    </Loader>
  {/snippet}
</Loader>

<style>
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 160px;
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
    background: var(--muted);
  }
  .col .b,
  .legend .b::before {
    background: var(--accent);
  }
  .legend {
    display: flex;
    gap: var(--sp-4);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .legend span:not(:last-child)::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-1);
  }
</style>
