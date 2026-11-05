<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { ModelRow } from "../../../../types/codeburn-models";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import Drawer from "../../ui/Drawer.svelte";
  import Loader from "./Loader.svelte";
  import { byCostDesc, cacheHit, isUnpriced } from "./models-derive";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();
  let picked = $state<ModelRow | null>(null);

  /** "—" when unpriced, "~" prefix when codeburn estimated the price. */
  const costText = (m: ModelRow) =>
    isUnpriced(m) ? "—" : `${m.isEstimated ? "~" : ""}${fmtCost(m.costUSD)}`;
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
                  <button type="button" class="plain" onclick={() => (picked = m)}>{m.modelDisplayName}</button>
                  <span class="note">{m.providerDisplayName}</span>
                  {#if isUnpriced(m)}<span class="note">(unpriced)</span>{/if}
                </td>
                <td class="n">{fmtCount(m.calls)}</td>
                <td class="n">{fmtTokens(m.totalTokens)}</td>
                <td class="n">{cacheHit(m).toFixed(1)}%</td>
                <td class="n">{costText(m)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note">Dollar figures are API-equivalent estimates, not what a subscription bills.</p>
    {/if}
  {/snippet}
</Loader>

<Drawer open={picked !== null} onClose={() => (picked = null)} title={picked?.modelDisplayName ?? "Model"} width="420px">
  {#if picked}
    <dl>
      <dt>Provider</dt><dd>{picked.providerDisplayName}</dd>
      <dt>Calls</dt><dd>{fmtCount(picked.calls)}</dd>
      <dt>Input</dt><dd>{fmtTokens(picked.inputTokens)}</dd>
      <dt>Output</dt><dd>{fmtTokens(picked.outputTokens)}</dd>
      <dt>Cache read</dt><dd>{fmtTokens(picked.cacheReadTokens)}</dd>
      <dt>Cache write</dt><dd>{fmtTokens(picked.cacheWriteTokens)}</dd>
      <dt>Cache hit</dt><dd>{cacheHit(picked).toFixed(1)}%</dd>
      <dt>Est. cost</dt><dd>{costText(picked)}</dd>
    </dl>
  {/if}
</Drawer>

<style>
  .plain {
    all: unset;
    cursor: pointer;
    text-decoration: underline dotted;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--sp-2) var(--sp-4);
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
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
