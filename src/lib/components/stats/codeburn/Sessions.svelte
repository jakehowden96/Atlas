<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { SessionRow, SessionWhy } from "../../../../types/codeburn-sessions";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import { sessionTarget } from "../../../stores/sessionTarget";
  import { openNewSession } from "../../../stores/view";
  import Button from "../../ui/Button.svelte";
  import Drawer from "../../ui/Drawer.svelte";
  import EmptyState from "../../ui/EmptyState.svelte";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import Loader from "./Loader.svelte";
  import { type SortKey, sortSessions, topCategory } from "./sessions-sort";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let key = $state<SortKey>("startedAt");
  let desc = $state(true);
  let picked = $state<SessionRow | null>(null);
  let query = $state("");
  let provider = $state("all");
  let open = $state<string | null>(null);

  // Opened from Overview: drop the filters that could hide it, expand it, then clear the request.
  $effect(() => {
    const id = $sessionTarget;
    if (!id) return;
    provider = "all";
    query = "";
    open = id;
    sessionTarget.set(null);
  });

  const providerTabs = (rows: SessionRow[]): Segment<string>[] => [
    { id: "all", label: "All" },
    ...[...new Set(rows.map((r) => r.provider))].sort().map((id) => ({ id, label: id })),
  ];
  const visible = (rows: SessionRow[]) => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (provider === "all" || r.provider === provider) &&
        (!q || `${r.title} ${r.project} ${r.sessionId}`.toLowerCase().includes(q)),
    );
  };

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

<Loader args={["sessions", "--format", "json", ...filterArgs(filters, "sessions"), "--contributions"]} {refresh}>
  {#snippet children(rows: SessionRow[])}
    {#if rows.length === 0}
      <EmptyState icon="folder" title="No sessions in this period" />
    {:else}
      <div class="bar">
        <SegmentedControl
          role="radiogroup"
          label="Provider"
          options={providerTabs(rows)}
          value={provider}
          onChange={(id) => (provider = id)}
          size="sm"
        />
        <input type="search" placeholder="Search sessions" aria-label="Search sessions" bind:value={query} />
      </div>
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
          {#each sortSessions(visible(rows), key, desc) as r (r.sessionId)}
            <tr>
              <td>
                <button
                  type="button"
                  class="plain"
                  aria-expanded={open === r.sessionId}
                  onclick={() => (open = open === r.sessionId ? null : r.sessionId)}
                >
                  {open === r.sessionId ? "⌄" : "›"}
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
            {#if open === r.sessionId}
              <tr class="why">
                <td colspan="7">
                  <Loader args={["sessions", "--id", r.sessionId, "--why", "--format", "json"]} {refresh}>
                    {#snippet children(why: SessionWhy)}
                      <p>
                        Subagents:
                        {why.helperCount
                          ? `${fmtCount(why.helperCount)} runs, ${fmtCost(why.helperCost ?? 0)} of ${fmtCost(why.cost)}`
                          : "—"}
                      </p>
                      <Button size="sm" onclick={() => (picked = r)}>Why it cost this</Button>
                    {/snippet}
                  </Loader>
                </td>
              </tr>
            {/if}
          {:else}
            <tr><td colspan="7">No sessions match.</td></tr>
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
  .bar {
    display: flex;
    gap: var(--sp-3);
    align-items: center;
    margin-bottom: var(--sp-3);
  }
  input {
    margin-left: auto;
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    color: inherit;
    font: inherit;
  }
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
