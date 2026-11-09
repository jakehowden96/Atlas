<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { ModelRow } from "../../../../types/codeburn-models";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import Button from "../../ui/Button.svelte";
  import Drawer from "../../ui/Drawer.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import { byCostDesc, cacheHit, isUnpriced } from "./models-derive";

  let { filters, refresh, onCompare }: { filters: Filters; refresh: number; onCompare: (model: string) => void } = $props();
  const DOTS = ["var(--accent)", "var(--warn)", "var(--muted)", "var(--danger)"];
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
      <Card title="By model">
        {#snippet note()}
          <Button size="sm" onclick={() => onCompare(rows[0]?.model ?? "")}>Compare…</Button>
        {/snippet}
        <table class="cb-table">
          <thead>
            <tr>
              <th>Model</th>
              <th class="num">Calls</th>
              <th class="num">Input</th>
              <th class="num">Output</th>
              <th class="num">Cache read</th>
              <th class="num">Cost</th>
              <th class="num">Saved</th>
            </tr>
          </thead>
          <tbody>
            {#each byCostDesc(rows) as m, i (m.providerDisplayName + m.modelDisplayName)}
              <tr>
                <td>
                  <span class="dot" style:background={DOTS[i % DOTS.length]}></span>
                  <button type="button" class="plain" onclick={() => (picked = m)}>{m.modelDisplayName}</button>
                  <div class="note">{m.providerDisplayName}</div>
                </td>
                <td class="num">{fmtCount(m.calls)}</td>
                <td class="num">{fmtTokens(m.inputTokens)}</td>
                <td class="num">{fmtTokens(m.outputTokens)}</td>
                <td class="num">{fmtTokens(m.cacheReadTokens)}</td>
                <td class="num">{costText(m)}</td>
                <td class="num">{isUnpriced(m) ? "—" : fmtCost(m.savingsUSD)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Card>
      <p class="note">Dollar figures are API-equivalent estimates, not what a subscription bills. ~ marks an estimated cost.</p>
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
    <Button size="sm" onclick={() => onCompare(picked!.model)}>Compare {picked.modelDisplayName}…</Button>

  {/if}
</Drawer>

<style>
  .plain {
    all: unset;
    cursor: pointer;
    color: var(--accent);
    text-decoration: underline;
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
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-2);
    border-radius: 50%;
  }
  .note {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
