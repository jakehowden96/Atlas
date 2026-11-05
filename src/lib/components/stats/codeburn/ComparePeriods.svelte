<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PeriodCompare } from "../../../../types/codeburn-compare";
  import { fmtCost } from "../../../stats-derive";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  interface Daily {
    daily: { date: string; cost: number }[];
  }

  const W = 600;
  const H = 160;
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
            {@const slot = W / Math.max(rows.length, 1)}
            <p class="legend">
              <span class="a">A {p.rangeA.from} to {p.rangeA.to}</span>
              <span class="b">B {p.rangeB.from} to {p.rangeB.to}</span>
              <span>Peak B day {peak > 0 ? fmtCost(peak) : "—"}</span>
            </p>
            {#if rows.every((r) => r.a === 0 && r.b === 0)}
              <p class="legend">No spend in either window.</p>
            {:else}
              <svg viewBox="0 0 {W} {H}" role="img" aria-label="Daily spend, window A against window B">
                {#each rows as r (r.i)}
                  <g>
                    <title>Day {r.i + 1}: A {fmtCost(r.a)}, B {fmtCost(r.b)}</title>
                    <rect x={r.i * slot} y="0" width={slot} height={H} fill="transparent" />
                    <rect class="a" x={r.i * slot + slot * 0.1} y={H - (r.a / max) * H} width={slot * 0.35} height={(r.a / max) * H} />
                    <rect class="b" x={r.i * slot + slot * 0.5} y={H - (r.b / max) * H} width={slot * 0.35} height={(r.b / max) * H} />
                  </g>
                {/each}
                <line class="peak" x1="0" x2={W} y1={H - (peak / max) * H} y2={H - (peak / max) * H} />
              </svg>
            {/if}
          {/snippet}
        </Loader>
      {/snippet}
    </Loader>
  {/snippet}
</Loader>

<style>
  svg {
    width: 100%;
    height: auto;
  }
  rect.a,
  .legend .a::before {
    fill: var(--muted);
    background: var(--muted);
  }
  rect.b,
  .legend .b::before {
    fill: var(--accent);
    background: var(--accent);
  }
  .peak {
    stroke: var(--accent);
    stroke-dasharray: 4 4;
    opacity: 0.6;
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
