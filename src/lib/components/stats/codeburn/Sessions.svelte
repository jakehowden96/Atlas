<script lang="ts">
  import type { Period } from "../../../../types/codeburn";
  import type { SessionRow, SessionWhy } from "../../../../types/codeburn-sessions";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import { openNewSession } from "../../../stores/view";
  import Button from "../../ui/Button.svelte";
  import Drawer from "../../ui/Drawer.svelte";
  import EmptyState from "../../ui/EmptyState.svelte";
  import Loader from "./Loader.svelte";
  import { type SortKey, sortSessions, topCategory } from "./sessions-sort";

  let { period, refresh }: { period: Period; refresh: number } = $props();

  let key = $state<SortKey>("startedAt");
  let desc = $state(true);
  let picked = $state<SessionRow | null>(null);

  const COLS: { key: SortKey; label: string }[] = [
    { key: "title", label: "Session" },
    { key: "project", label: "Project" },
    { key: "startedAt", label: "Started" },
    { key: "turns", label: "Turns" },
    { key: "calls", label: "Calls" },
    { key: "cost", label: "Cost" },
  ];

  function sortBy(k: SortKey) {
    desc = k === key ? !desc : k !== "title" && k !== "project";
    key = k;
  }
</script>

<Loader args={["sessions", "--format", "json", "--period", period, "--contributions"]} {refresh}>
  {#snippet children(rows: SessionRow[])}
    {#if rows.length === 0}
      <EmptyState icon="folder" title="No sessions in this period" />
    {:else}
      <table>
        <thead>
          <tr>
            {#each COLS as c (c.key)}
              <th aria-sort={c.key === key ? (desc ? "descending" : "ascending") : "none"}>
                <button type="button" class="plain" onclick={() => sortBy(c.key)}>{c.label}</button>
              </th>
            {/each}
            <th>Mostly</th>
          </tr>
        </thead>
        <tbody>
          {#each sortSessions(rows, key, desc) as r (r.sessionId)}
            <tr>
              <td>
                <button type="button" class="plain" onclick={() => (picked = r)}>
                  {r.title || r.sessionId.slice(0, 8)}
                </button>
              </td>
              <td>{r.project}</td>
              <td>{r.startedAt.slice(0, 16).replace("T", " ")}</td>
              <td class="num">{fmtCount(r.turns)}</td>
              <td class="num">{fmtCount(r.calls)}</td>
              <td class="num">{fmtCost(r.cost)}</td>
              <td>{topCategory(r)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/snippet}
</Loader>

<Drawer
  open={picked !== null}
  onClose={() => (picked = null)}
  title={picked?.title || "Session"}
  width="560px"
>
  {#if picked}
    <Loader args={["sessions", "--id", picked.sessionId, "--why", "--format", "json"]} {refresh}>
      {#snippet children(why: SessionWhy)}
        <p>
          {fmtCost(why.cost)} over {fmtCount(why.calls)} calls, {fmtCount(why.turns.length)} turns.
        </p>
        <Button
          size="sm"
          onclick={() =>
            openNewSession({ workspacePath: why.project, resumeSessionId: why.sessionId })}
        >
          Resume session
        </Button>
        {#if why.findings?.length}
          <h4>Findings</h4>
          <ul>
            {#each why.findings as f (f.id)}
              <li>
                {f.kind}{f.turn ? ` (turn ${f.turn})` : ""}: {fmtCost(f.usd)}, {Math.round(
                  f.share * 100,
                )}%
                {#if f.alt}; {f.alt.model} would be {fmtCost(f.alt.cost)}{/if}
              </li>
            {/each}
          </ul>
        {/if}
        <h4>Spend by prompt</h4>
        <ol>
          {#each why.turns as t (t.i)}
            <li>{fmtCost(t.cost)}: {t.prompt?.text.slice(0, 120) ?? "(no prompt)"}</li>
          {/each}
        </ol>
      {/snippet}
    </Loader>
  {/if}
</Drawer>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--sp-1) var(--sp-2);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .plain {
    all: unset;
    cursor: pointer;
  }
</style>
