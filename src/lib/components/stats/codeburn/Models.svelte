<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { ModelRow } from "../../../../types/codeburn-models";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import Loader from "./Loader.svelte";
  import { byCostDesc, cacheHit, isUnpriced } from "./models-derive";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();
</script>

<Loader args={["models", "--format", "json", ...filterArgs(filters, "models"), "--min-cost", "0"]} {refresh}>
  {#snippet children(rows: ModelRow[])}
    {#if rows.length === 0}
      <p class="note">No model usage in this period.</p>
    {:else}
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th class="n">Calls</th>
              <th class="n">Tokens</th>
              <th class="n">Cache hit</th>
              <th class="n">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {#each byCostDesc(rows) as m (m.providerDisplayName + m.modelDisplayName)}
              <tr>
                <td>
                  {m.modelDisplayName}
                  <span class="note">{m.providerDisplayName}</span>
                  {#if isUnpriced(m)}<span class="note">(unpriced)</span>{/if}
                </td>
                <td class="n">{fmtCount(m.calls)}</td>
                <td class="n">{fmtTokens(m.totalTokens)}</td>
                <td class="n">{cacheHit(m).toFixed(1)}%</td>
                <td class="n">{isUnpriced(m) ? "-" : fmtCost(m.costUSD)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note">Dollar figures are API-equivalent estimates, not what a subscription bills.</p>
    {/if}
  {/snippet}
</Loader>

<style>
  .card {
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: var(--sp-2);
    text-align: left;
  }
  .n {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .note {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
