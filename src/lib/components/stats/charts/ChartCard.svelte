<script lang="ts">
  import type { Snippet } from "svelte";
  import MenuButton from "../../ui/MenuButton.svelte";
  import SegmentedControl from "../../ui/SegmentedControl.svelte";
  import Skeleton from "../../ui/Skeleton.svelte";
  import { formatValue, toCsv, type Point, type Unit } from "../../../stats-chart";

  interface Props {
    /** Persists the Chart/Table choice per chart. */
    id: string;
    title: string;
    /** One-line summary in words; read first by screen readers. */
    summary: string;
    /** The same data the chart draws; the table and CSV use it. */
    rows: Point[];
    unit: Unit;
    loading?: boolean;
    children: Snippet;
  }

  let { id, title, summary, rows, unit, loading = false, children }: Props = $props();

  const key = $derived(`atlas.stats.view.${id}`);
  function load(): "chart" | "table" {
    try {
      return localStorage.getItem(`atlas.stats.view.${id}`) === "table" ? "table" : "chart";
    } catch {
      return "chart";
    }
  }
  let view = $state<"chart" | "table">(load());
  let desc = $state(true);

  function setView(v: "chart" | "table") {
    view = v;
    try {
      localStorage.setItem(key, v);
    } catch {
      /* per-viewer convenience only */
    }
  }

  const sorted = $derived([...rows].sort((a, b) => (desc ? b.value - a.value : a.value - b.value)));
  const copyCsv = () =>
    navigator.clipboard?.writeText(
      toCsv([["Bucket", "Value"], ...rows.map((r) => [r.label, r.value])]),
    );
</script>

<figure class="card">
  <figcaption>{summary}</figcaption>
  <header>
    <h3>{title}</h3>
    <SegmentedControl
      role="radiogroup"
      size="sm"
      label={`${title} view`}
      options={[
        { id: "chart", label: "Chart" },
        { id: "table", label: "Table" },
      ]}
      value={view}
      onChange={setView}
    />
    <MenuButton
      icon="more_horiz"
      label={`${title} options`}
      items={[{ id: "csv", label: "Copy as CSV" }]}
      onselect={copyCsv}
      align="end"
    />
  </header>
  <div class="body">
    {#if loading}
      <Skeleton height="160px" />
    {:else if view === "table"}
      <table>
        <thead>
          <tr>
            <th scope="col">Bucket</th>
            <th scope="col" class="num" aria-sort={desc ? "descending" : "ascending"}>
              <button type="button" onclick={() => (desc = !desc)}>Value</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as r (r.key)}
            <tr><td>{r.label}</td><td class="num">{formatValue(r.value, unit)}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      {@render children()}
    {/if}
  </div>
</figure>

<style>
  .card {
    margin: 0;
    padding: var(--sp-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .card {
    display: flex;
    flex-direction: column;
  }
  /* The caption comes first in the DOM so screen readers get it first. */
  header {
    order: -1;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  h3 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  figcaption {
    margin: var(--sp-1) 0 var(--sp-4);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
  }
  th,
  td {
    padding: var(--sp-1) var(--sp-3);
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .num {
    text-align: right;
    font-family: var(--font-mono);
  }
  th button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  th button:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 1px;
  }
</style>
