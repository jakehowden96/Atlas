<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PullRequests } from "../../../../types/codeburn-prs";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import EmptyState from "../../ui/EmptyState.svelte";
  import Card from "./Card.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let open = $state<string | null>(null);
</script>

<Loader args={["sessions", "--by-pr", "--format", "json", ...filterArgs(filters, "sessions")]} {refresh}>
  {#snippet children(d: PullRequests)}
    {@const rows = [...d.prs].sort((a, b) => b.cost - a.cost)}
    <div class="page">
      <Card title="Pull request spend">
        <div class="kpis">
          <div class="tile"><Kpi label="ATTRIBUTED SPEND" value={fmtCost(d.distinct.attributedCost)} /></div>
          <div class="tile"><Kpi label="PULL REQUESTS" value={fmtCount(d.prs.length)} /></div>
          <div class="tile"><Kpi label="LINKED SESSIONS" value={fmtCount(d.distinct.sessions)} /></div>
          <div class="tile"><Kpi label="FOLDED AGENT RUNS" value="—" /></div>
        </div>
      </Card>

      <Card title="Attributed pull requests">
        {#snippet note()}Sorted by spend, highest first <span class="pill">{rows.length} total</span>{/snippet}
        {#if rows.length === 0}
          <EmptyState icon="folder" title="No pull requests in this period" />
        {:else}
          <div class="list">
            {#each rows as p (p.url)}
              <div class="pr" class:open={open === p.url}>
                <button type="button" aria-expanded={open === p.url} onclick={() => (open = open === p.url ? null : p.url)}>
                  <span class="icon" aria-hidden="true">⑂</span>
                  <span class="main">
                    <b>{p.label}</b>
                    <span class="sub">{fmtCount(p.sessions)} {p.sessions === 1 ? "run" : "runs"} · — calls</span>
                    <span class="sub">
                      {p.state === "merged" ? "Merged" : "Open"} · Follow-ups: not tracked · No review run found
                    </span>
                  </span>
                  <span class="col"><span class="h">MODELS</span><span class="sub">—</span></span>
                  <span class="col end"><span class="h">SPEND</span><b class="mono">{fmtCost(p.cost)}</b></span>
                  <span class="chev" aria-hidden="true">{open === p.url ? "⌄" : "›"}</span>
                </button>
                {#if open === p.url}
                  <div class="detail">
                    <div class="kv"><span>Link</span><span>{p.url}</span></div>
                    <div class="kv"><span>Linked sessions</span><span>{fmtCount(p.sessions)}</span></div>
                    <div class="kv"><span>Attributed</span><span>{fmtCost(p.cost)}</span></div>
                    <div class="kv">
                      <span>Share of attributed</span>
                      <span>
                        {d.distinct.attributedCost > 0
                          ? `${Math.round((p.cost / d.distinct.attributedCost) * 100)}%`
                          : "—"}
                      </span>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        <p class="footnote">
          Costs are attributed turn by turn, so every row adds up without double counting.
          <br />Not tied to a specific PR: {fmtCost(d.distinct.unattributedCost)}
        </p>
      </Card>
    </div>
  {/snippet}
</Loader>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-3);
  }
  .tile {
    min-width: 0;
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--surface) 92%, white);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .pr {
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--surface) 90%, black);
  }
  .pr.open {
    border-color: var(--accent);
  }
  .pr button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    width: 100%;
    padding: var(--sp-3) var(--sp-4);
    cursor: pointer;
  }
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--sp-0);
    flex: 1;
    min-width: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    min-width: 90px;
  }
  .col.end {
    align-items: flex-end;
  }
  .h {
    color: var(--muted);
    font-size: var(--fs-2xs);
    letter-spacing: 0.06em;
  }
  .sub {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .chev {
    padding: 0 var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .pill {
    padding: 0 var(--sp-2);
    border-radius: var(--r-card);
    background: var(--border);
    font-family: var(--font-mono);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-md, var(--fs-sm));
    font-variant-numeric: tabular-nums;
  }
  .detail {
    padding: 0 var(--sp-4) var(--sp-3);
    font-size: var(--fs-sm);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-1) 0;
  }
  .footnote {
    margin: var(--sp-3) 0 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
