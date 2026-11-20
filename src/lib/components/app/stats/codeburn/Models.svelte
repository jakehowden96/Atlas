<script lang="ts">
  import { filterArgs, type Filters } from "../../../../../types/codeburn";
  import type { ModelRow } from "../../../../../types/codeburn-models";
  import { fmtCost, fmtCount, fmtTokens } from "../../../../stats-derive";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import Segmented from "$lib/components/app/common/Segmented.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import {
    byCostDesc,
    cacheHit,
    isUnpriced,
    pricingStatus,
    sortRows,
    type SortKey,
  } from "./models-derive";

  let {
    filters,
    refresh,
    onCompare,
  }: { filters: Filters; refresh: number; onCompare: (model: string) => void } = $props();
  const DOTS = [
    "var(--success)",
    "var(--warning)",
    "var(--muted-foreground)",
    "var(--destructive)",
  ];
  const TABS = [
    { id: "by-model", label: "By model" },
    { id: "audit", label: "Audit" },
  ] as const;
  type Tab = (typeof TABS)[number]["id"];

  let tab = $state<Tab>("by-model");
  let picked = $state<ModelRow | null>(null);
  let sort = $state<{ k: SortKey; dir: 1 | -1 }>({ k: "costUSD", dir: -1 });

  const priced = (m: ModelRow) => !isUnpriced(m);
  /** "—" when unpriced, "~" prefix when codeburn estimated the price. */
  const costText = (m: ModelRow) =>
    priced(m) ? `${m.isEstimated ? "~" : ""}${fmtCost(m.costUSD)}` : "—";
  const SOURCE = {
    priced: "List price",
    estimated: "Estimated from similar model",
    unpriced: "No pricing data",
  };
  const PILL = { priced: "", estimated: "warn", unpriced: "bad" };

  function setSort(k: SortKey) {
    sort = { k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : k === "modelDisplayName" ? 1 : -1 };
  }
  const ariaSort = (k: SortKey) =>
    sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined;
  const arrow = (k: SortKey) => (sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : "");
</script>

{#snippet th(k: SortKey, label: string, num = false)}
  <th scope="col" class:r={num} aria-sort={ariaSort(k)}>
    <button type="button" onclick={() => setSort(k)}>{label}{arrow(k)}</button>
  </th>
{/snippet}

{#snippet name(m: ModelRow, i: number)}
  <span class="dot" style:background={DOTS[i % DOTS.length]}></span>
  <button type="button" class="mo-link" onclick={() => (picked = m)}>{m.modelDisplayName}</button>
  <div class="sub mo-prov">{m.providerDisplayName}</div>
{/snippet}

<Loader
  args={["models", "--format", "json", ...filterArgs(filters, "models"), "--min-cost", "0"]}
  {refresh}
>
  {#snippet children(rows: ModelRow[])}
    {@const sorted = sortRows(byCostDesc(rows), sort)}
    {@const un = rows.filter(isUnpriced)}
    <Card title="By model">
      {#snippet note()}
        <span class="tools">
          <Segmented
            size="sm"
            label="Models view"
            options={[...TABS]}
            value={tab}
            onChange={(id) => (tab = id)}
          />
          <Button variant="outline" size="sm" onclick={() => onCompare(rows[0]?.model ?? "")}
            >Compare…</Button
          >
        </span>
      {/snippet}
      {#if rows.length === 0}
        <p class="empty">No models for this provider</p>
      {:else if tab === "by-model"}
        <p class="sub lead">
          {rows.length} models · {fmtCost(
            rows.reduce((s, m) => s + (priced(m) ? m.costUSD : 0), 0),
          )} priced · {un.length} unpriced ({fmtCount(un.reduce((s, m) => s + m.calls, 0))} calls). ~
          marks an estimated cost.
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                {@render th("modelDisplayName", "Model")}
                {@render th("calls", "Calls", true)}
                {@render th("inputTokens", "Input", true)}
                {@render th("outputTokens", "Output", true)}
                {@render th("cacheReadTokens", "Cache read", true)}
                {@render th("costUSD", "Cost", true)}
                {@render th("savingsUSD", "Saved", true)}
              </tr>
            </thead>
            <tbody>
              {#each sorted as m, i (m.providerDisplayName + m.modelDisplayName)}
                <tr>
                  <td>{@render name(m, i)}</td>
                  <td class="r">{fmtCount(m.calls)}</td>
                  <td class="r">{fmtTokens(m.inputTokens)}</td>
                  <td class="r">{fmtTokens(m.outputTokens)}</td>
                  <td class="r">{fmtTokens(m.cacheReadTokens)}</td>
                  <td class="r">{costText(m)}</td>
                  <td class="r">{priced(m) ? fmtCost(m.savingsUSD) : "—"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="sub lead">
          Pricing audit. {un.length} model{un.length === 1 ? "" : "s"} unpriced and excluded from totals.
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                {@render th("modelDisplayName", "Model")}
                {@render th("calls", "Calls", true)}
                <th scope="col">Pricing source</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each sorted as m, i (m.providerDisplayName + m.modelDisplayName)}
                {@const st = pricingStatus(m)}
                <tr>
                  <td>{@render name(m, i)}</td>
                  <td class="r">{fmtCount(m.calls)}</td>
                  <td>{SOURCE[st]}</td>
                  <td><span class="pill {PILL[st]}">{st}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>
  {/snippet}
</Loader>

<Sheet.Root
  open={picked !== null}
  onOpenChange={(o) => {
    if (!o) (() => (picked = null))();
  }}
>
  <Sheet.Content
    class="w-[min(520px,calc(100vw-3rem))]"
    aria-label="{picked?.modelDisplayName ?? 'Model'} details"
  >
    <Sheet.Body>
      {#if picked}
        <div class="dr">
          <h2>{picked.modelDisplayName}</h2>
          <p class="sub">{picked.providerDisplayName}</p>
          <div class="kv"><span>Calls</span><span>{fmtCount(picked.calls)}</span></div>
          <div class="kv"><span>Cost</span><span>{costText(picked)}</span></div>
          <div class="kv">
            <span>Tokens in / out / cache</span><span
              >{fmtTokens(picked.inputTokens)} / {fmtTokens(picked.outputTokens)} / {fmtTokens(
                picked.cacheReadTokens,
              )}</span
            >
          </div>
          <div class="kv">
            <span>Cache write</span><span>{fmtTokens(picked.cacheWriteTokens)}</span>
          </div>
          <div class="kv"><span>Cache hit</span><span>{cacheHit(picked).toFixed(1)}%</span></div>
          <p class="act">
            <Button variant="default" onclick={() => onCompare(picked!.model)}
              >Compare {picked.modelDisplayName}…</Button
            >
          </p>
        </div>
      {/if}
    </Sheet.Body>
  </Sheet.Content>
</Sheet.Root>

<style>
  .tools {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-4);
  }
  .sub {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .lead {
    margin-bottom: var(--sp-3);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    text-align: center;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-caption);
  }
  th {
    padding: var(--sp-2);
    text-align: left;
    font-size: var(--text-xs);
    font-weight: var(--font-weight-medium);
    color: var(--muted-foreground);
    border-bottom: 1px solid var(--input);
    white-space: nowrap;
  }
  th[aria-sort] {
    color: var(--foreground);
  }
  th button {
    all: unset;
    cursor: pointer;
  }
  th button:focus-visible {
    outline: 2px solid var(--foreground);
    outline-offset: 2px;
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
    background: var(--muted);
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
  }
  th:last-child,
  td:last-child {
    padding-right: 0;
  }
  .r {
    text-align: right;
  }
  td.r {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    display: inline-block;
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-right: var(--sp-3);
    border-radius: 50%;
  }
  .mo-link {
    all: unset;
    cursor: pointer;
    color: var(--foreground);
    font-weight: var(--font-weight-medium);
    text-decoration: underline;
    text-decoration-color: var(--input);
    text-underline-offset: 2px;
  }
  .mo-link:hover {
    color: var(--success);
    text-decoration-color: var(--success);
  }
  .mo-link:focus-visible {
    outline: 2px solid var(--foreground);
    outline-offset: 2px;
  }
  .mo-prov {
    font-size: var(--text-xs);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--radius-full);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
    background: color-mix(in srgb, var(--success) 16%, transparent);
    color: var(--success);
  }
  .pill.warn {
    background: color-mix(in srgb, var(--warning) 16%, transparent);
    color: var(--warning);
  }
  .pill.bad {
    background: color-mix(in srgb, var(--destructive) 16%, transparent);
    color: var(--destructive);
  }
  .dr {
    /* the top bar (z 70) paints over the drawer layer (z 20), so clear it */
    padding: calc(var(--h-bar) + var(--sp-4)) var(--sp-5) var(--sp-5);
  }
  .dr h2 {
    margin: 0 0 var(--sp-1);
    font-size: var(--text-md, 15px);
    font-weight: var(--font-weight-semibold);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) 0;
    font-size: var(--text-caption);
  }
  .kv > :first-child {
    color: var(--muted-foreground);
  }
  .kv > :last-child {
    font-family: var(--font-mono);
    font-weight: var(--font-weight-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .act {
    margin: var(--sp-4) 0 0;
  }
</style>
