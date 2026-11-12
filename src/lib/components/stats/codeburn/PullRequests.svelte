<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { PullRequests } from "../../../../types/codeburn-prs";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let open = $state<string | null>(null);
</script>

<Loader
  args={["sessions", "--by-pr", "--format", "json", ...filterArgs(filters, "sessions")]}
  {refresh}
>
  {#snippet children(d: PullRequests)}
    {@const rows = [...d.prs].sort((a, b) => b.cost - a.cost)}
    <div class="page">
      <Card title="Pull request spend">
        <div class="grid">
          {#each [["Attributed spend", fmtCost(d.distinct.attributedCost)], ["Pull requests", fmtCount(d.prs.length)], ["Linked sessions", fmtCount(d.distinct.sessions)], ["Folded agent runs", "—"]] as [k, v] (k)}
            <div class="kpi">
              <div class="k">{k}</div>
              <div class="v">{v}</div>
            </div>
          {/each}
        </div>
      </Card>

      <Card title="Attributed pull requests">
        {#snippet note()}Sorted by spend, highest first <span class="pill neutral"
            >{rows.length} total</span
          >{/snippet}
        {#if rows.length === 0}
          <p class="empty">No pull requests in this range</p>
        {:else}
          {#each rows as p (p.url)}
            {@const isOpen = open === p.url}
            <div class="pr-w" class:open={isOpen}>
              <button
                type="button"
                class="pr"
                aria-expanded={isOpen}
                onclick={() => (open = isOpen ? null : p.url)}
              >
                <span class="pr-ic">
                  <svg viewBox="0 0 16 16" aria-hidden="true"
                    ><path d="M4 3v10M4 13a1.5 1.5 0 1 0 0-.01M12 13V7a2 2 0 0 0-2-2H8" /></svg
                  >
                </span>
                <span class="pr-main">
                  <h5>{p.label}</h5>
                  <span class="sub"
                    >{fmtCount(p.sessions)}
                    {p.sessions === 1 ? "run" : "runs"}<i class="pr-sep"></i>— calls</span
                  >
                  <span class="sub"
                    >{p.state === "merged" ? "Merged" : "Open"}<i class="pr-sep"></i>Follow-ups: not
                    tracked</span
                  >
                </span>
                <span class="pr-m"
                  ><span class="sub">MODELS</span><span class="pill neutral">—</span></span
                >
                <span class="pr-s"
                  ><span class="sub">SPEND</span><b class="mono">{fmtCost(p.cost)}</b></span
                >
                <span class="pr-chev" aria-hidden="true">{isOpen ? "⌄" : "›"}</span>
              </button>
              {#if isOpen}
                <div class="pr-detail">
                  <div class="sub">Per-model split unavailable</div>
                  <div>
                    <div class="kv">
                      <span>Linked sessions</span><span>{fmtCount(p.sessions)}</span>
                    </div>
                    <div class="kv"><span>Calls</span><span>—</span></div>
                    <div class="kv">
                      <span>Attributed to this PR</span><span>{fmtCost(p.cost)}</span>
                    </div>
                    <div class="kv"><span>Other work, same session</span><span>—</span></div>
                    <div class="kv"><span>Review</span><span>—</span></div>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
        <p class="sub foot">
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
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  .kpi {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .k {
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .v {
    margin-top: var(--sp-1);
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    font-weight: var(--fw-semi);
    font-variant-numeric: tabular-nums;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--h-xs);
    padding: 0 var(--sp-3);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .pill.neutral {
    background: var(--surface3);
    color: var(--muted);
  }
  .empty {
    margin: 0;
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
  .pr-w {
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface2);
  }
  .pr-w + .pr-w {
    margin-top: var(--sp-3);
  }
  .pr-w.open {
    border-color: var(--accent);
  }
  .pr {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 150px 90px 28px;
    gap: var(--sp-4);
    align-items: center;
    width: 100%;
    padding: var(--sp-4);
    border: 0;
    border-radius: var(--r-card);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pr:hover {
    background: var(--surface3);
  }
  .pr:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  h5 {
    margin: 0 0 var(--sp-1);
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
    overflow-wrap: anywhere;
  }
  .pr .sub {
    display: block;
    font-size: var(--fs-2xs);
  }
  .pr-ic {
    display: grid;
    place-items: center;
    width: 36px;
    aspect-ratio: 1;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }
  .pr-ic svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pr-sep {
    display: inline-block;
    width: 3px;
    height: 3px;
    margin: 0 var(--sp-2) 2px;
    border-radius: 50%;
    background: var(--muted);
  }
  .pr-m,
  .pr-s {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    align-items: flex-start;
  }
  .pr-s {
    align-items: flex-end;
  }
  .pr-s b {
    font-size: var(--fs-xl);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .pr-chev {
    display: grid;
    place-items: center;
    width: 28px;
    height: var(--h-md);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    color: var(--muted);
  }
  .pr-detail {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-5);
    padding: var(--sp-4) var(--sp-5) var(--sp-5);
    border-top: 1px solid var(--border);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) 0;
    font-size: var(--fs-xs);
  }
  .kv > :first-child {
    color: var(--muted);
  }
  .kv > :last-child {
    font-family: var(--font-mono);
    font-weight: var(--fw-medium);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .foot {
    margin-top: var(--sp-4);
  }

  @media (max-width: 860px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 760px) {
    .pr {
      grid-template-columns: 36px minmax(0, 1fr) 28px;
    }
    .pr-m,
    .pr-s {
      grid-column: 2;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .pr-detail {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
