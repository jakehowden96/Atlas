<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PullRequests } from "../../../../types/codeburn-prs";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import EmptyState from "../../ui/EmptyState.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let open = $state<string | null>(null);
</script>

<Loader args={["sessions", "--by-pr", "--format", "json", ...filterArgs(filters, "sessions")]} {refresh}>
  {#snippet children(d: PullRequests)}
    {@const rows = [...d.prs].sort((a, b) => b.cost - a.cost)}
    <div class="kpis">
      <div class="card"><Kpi label="Pull requests" value={fmtCount(d.prs.length)} /></div>
      <div class="card"><Kpi label="Total cost" value={fmtCost(d.distinct.cost)} /></div>
      <div class="card">
        <Kpi label="Attributed to a PR" value={fmtCost(d.distinct.attributedCost)} />
      </div>
      <div class="card">
        <Kpi label="Unattributed" value={fmtCost(d.distinct.unattributedCost)} />
      </div>
    </div>

    {#if rows.length === 0}
      <EmptyState icon="folder" title="No pull requests in this period" />
    {:else}
      <div class="list">
        {#each rows as p (p.url)}
          <div class="pr">
            <button type="button" aria-expanded={open === p.url} onclick={() => (open = open === p.url ? null : p.url)}>
              <span class="main">
                <b>{p.label}</b>
                <span class="sub">{fmtCount(p.sessions)} sessions · Follow-ups: —</span>
              </span>
              <span class="pill">{p.state ?? "open"}</span>
              <b class="mono">{fmtCost(p.cost)}</b>
              <span aria-hidden="true">{open === p.url ? "⌄" : "›"}</span>
            </button>
            {#if open === p.url}
              <div class="detail">
                <div class="kv"><span>Link</span><span>{p.url}</span></div>
                <div class="kv"><span>Sessions</span><span>{fmtCount(p.sessions)}</span></div>
                <div class="kv"><span>Attributed to this PR</span><span>{fmtCost(p.cost)}</span></div>
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
      Dollar figures are API-equivalent estimates, not what a subscription bills.
    </p>
  {/snippet}
</Loader>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-3);
  }

  .list {
    margin-top: var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .pr + .pr {
    border-top: 1px solid var(--border);
  }
  .pr button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-3) var(--sp-4);
    cursor: pointer;
  }
  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .sub {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .pill {
    padding: 0 var(--sp-2);
    border-radius: var(--r-card);
    background: var(--surface-2, var(--border));
    font-size: var(--fs-xs);
  }
  .mono {
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

  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .card {
    min-width: 0;
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }

  .footnote {
    margin: var(--sp-3) 0 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
