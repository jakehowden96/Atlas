<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { SessionRow, SessionWhy } from "../../../../types/codeburn-sessions";
  import { fmtCost, fmtCount, fmtTokens } from "../../../stats-derive";
  import { sessionTarget } from "../../../stores/sessionTarget";
  import { openNewSession } from "../../../stores/view";
  import Button from "../../ui/Button.svelte";
  import ConnectorLogo from "../../ui/ConnectorLogo.svelte";
  import EmptyState from "../../ui/EmptyState.svelte";
  import Loader from "./Loader.svelte";
  import { type SortKey, sortSessions } from "./sessions-sort";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let key = $state<SortKey>("cost");
  let query = $state("");
  let provider = $state("all");
  let group = $state(false);
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

  const SORTS: { key: SortKey; label: string }[] = [
    { key: "cost", label: "Cost" },
    { key: "startedAt", label: "Recent" },
    { key: "turns", label: "Turns" },
    { key: "outputTokens", label: "Tokens" },
  ];

  const providers = (rows: SessionRow[]) => [...new Set(rows.map((r) => r.provider))].sort();
  const sum = (rows: SessionRow[], f: (r: SessionRow) => number) =>
    rows.reduce((a, r) => a + f(r), 0);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const inTab = (rows: SessionRow[]) =>
    rows.filter((r) => provider === "all" || r.provider === provider);
  const visible = (rows: SessionRow[]) => {
    const q = query.trim().toLowerCase();
    return sortSessions(
      inTab(rows).filter(
        (r) =>
          !q || `${r.title} ${r.project} ${r.sessionId} ${r.models.join(" ")}`.toLowerCase().includes(q),
      ),
      key,
      true,
    );
  };
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
</script>

<Loader args={["sessions", "--format", "json", ...filterArgs(filters, "sessions"), "--contributions"]} {refresh}>
  {#snippet children(rows: SessionRow[])}
    {#if rows.length === 0}
      <EmptyState icon="folder" title="No sessions in this period" />
    {:else}
      {@const list = visible(rows)}
      <div class="wrap">
        <div class="seg" role="radiogroup" aria-label="Provider">
          {#each ["all", ...providers(rows)] as id (id)}
            <button
              type="button"
              role="radio"
              aria-checked={provider === id}
              onclick={() => (provider = id)}
            >
              {#if id !== "all"}<ConnectorLogo connector={id} size={16} />{/if}
              <span class="cap">{id === "all" ? "All" : id}</span>
              <span class="se-n">{id === "all" ? rows.length : rows.filter((r) => r.provider === id).length}</span>
            </button>
          {/each}
        </div>
        <div class="bar">
          <input
            class="search"
            type="search"
            placeholder="Search project, model, or id…"
            aria-label="Search sessions"
            bind:value={query}
          />
          <div class="se-sort" role="group" aria-label="Sort">
            {#each SORTS as s (s.key)}
              <button type="button" aria-pressed={key === s.key} onclick={() => (key = s.key)}>{s.label}</button>
            {/each}
          </div>
          <button type="button" class="btn" class:primary={group} aria-pressed={group} onclick={() => (group = !group)}>
            Group by provider
          </button>
        </div>
        <div class="list">
          <p class="sub">
            {plural(list.length, "session")}{rows.some((r) => r.helperCount !== undefined)
              ? ` + ${plural(sum(list, (r) => r.helperCount ?? 0), "subagent")}`
              : ""}
            · {fmtCost(sum(list, (r) => r.cost))} · {fmtTokens(sum(list, (r) => r.outputTokens))} tokens
          </p>
          {#if list.length === 0}
            <p class="empty">
              No sessions match{query ? ` “${query}”` : ""}.
              {#if query}<button type="button" class="link" onclick={() => (query = "")}>Clear search</button>{/if}
            </p>
          {:else}
            <div class="cols">
              <span></span><span>Session</span>
              <button type="button" aria-pressed={key === "startedAt"} onclick={() => (key = "startedAt")}>Date</button>
              <span>Model</span>
              <button type="button" class="r" aria-pressed={key === "turns"} onclick={() => (key = "turns")}>Turns</button>
              <button type="button" class="r" aria-pressed={key === "cost"} onclick={() => (key = "cost")}>Cost</button>
              <button type="button" class="r" aria-pressed={key === "outputTokens"} onclick={() => (key = "outputTokens")}>Tokens</button>
            </div>
            {#each group ? providers(list) : [null] as g (g ?? "")}
              {@const rs = g ? list.filter((r) => r.provider === g) : list}
              <section class="card">
                {#if g}
                  <div class="ghead">
                    <span class="gname"><ConnectorLogo connector={g} size={16} />{g}</span>
                    <span>{plural(rs.length, "session")} · {fmtCost(sum(rs, (r) => r.cost))}</span>
                  </div>
                {/if}
                {#each rs as r (r.sessionId)}
                  <div class="sess">
                    <button
                      type="button"
                      class="row"
                      aria-expanded={open === r.sessionId}
                      onclick={() => (open = open === r.sessionId ? null : r.sessionId)}
                    >
                      <span class="chev" class:open={open === r.sessionId} aria-hidden="true">›</span>
                      <span class="t">
                        <b>{r.title || r.sessionId.slice(0, 8)}</b>
                        <span class="id">
                          {#if !group}<ConnectorLogo connector={r.provider} size={16} />{/if}{r.sessionId}{r.helperCount
                            ? ` · ${plural(r.helperCount, "subagent")}`
                            : ""}
                        </span>
                      </span>
                      <span class="hide muted">{day(r.startedAt)}</span>
                      <span class="hide">{r.models[0] ?? "—"}</span>
                      <span class="hide num">{fmtCount(r.turns)}</span>
                      <span class="num">{fmtCost(r.cost)}</span>
                      <span class="hide num">{fmtTokens(r.outputTokens)}</span>
                    </button>
                    {#if open === r.sessionId}
                      <div class="why">
                        <Loader args={["sessions", "--id", r.sessionId, "--why", "--format", "json"]} {refresh}>
                          {#snippet children(why: SessionWhy)}
                            <p class="sub gapb">
                              Subagents ·
                              {why.helperCount
                                ? `${plural(why.helperCount, "run")}, ${fmtCost(why.helperCost ?? 0)} of ${fmtCost(why.cost)}`
                                : "—"}
                            </p>
                            {#each why.findings ?? [] as f (f.id)}
                              <div class="kv">
                                <span>{f.kind}{f.turn ? ` (turn ${f.turn})` : ""}</span>
                                <span>
                                  {fmtCost(f.usd)} · {Math.round(f.share * 100)}%{f.alt
                                    ? ` · ${f.alt.model} would be ${fmtCost(f.alt.cost)}`
                                    : ""}
                                </span>
                              </div>
                            {/each}
                            <p class="sub gap">Why it cost this: biggest turns</p>
                            {#each [...why.turns].sort((a, b) => b.cost - a.cost).slice(0, 5) as t (t.i)}
                              <div class="kv">
                                <span>{t.prompt?.text.slice(0, 80) ?? "(no prompt)"}</span>
                                <span>{fmtCost(t.cost)} · {plural(t.calls, "call")}</span>
                              </div>
                            {/each}
                            <Button
                              size="sm"
                              onclick={() =>
                                openNewSession({ workspacePath: why.project, resumeSessionId: why.sessionId })}
                            >
                              Resume session
                            </Button>
                          {/snippet}
                        </Loader>
                      </div>
                    {/if}
                  </div>
                {/each}
              </section>
            {/each}
          {/if}
          <p class="sub">Showing {list.length} of {inTab(rows).length} top-level sessions</p>
        </div>
      </div>
    {/if}
  {/snippet}
</Loader>

<style>
  .wrap {
    --g: 16px minmax(0, 1fr) 70px 110px 40px 72px 70px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    max-width: 1000px;
    margin: 0 auto;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    flex-wrap: wrap;
  }
  button {
    font: inherit;
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    max-width: 100%;
    overflow-x: auto;
    align-self: flex-start;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    height: var(--h-sm);
    padding: 0 var(--sp-4);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: none;
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--text);
  }
  .seg button[aria-checked="true"] {
    background: var(--surface);
    border-color: var(--border2);
    color: var(--text);
  }
  .cap {
    text-transform: capitalize;
  }
  .se-n {
    margin-left: var(--sp-2);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
  .search {
    height: var(--h-md);
    width: 240px;
    max-width: 100%;
    padding: 0 var(--sp-4);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .search:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .se-sort {
    display: inline-flex;
    gap: var(--sp-4);
  }
  .se-sort button {
    height: var(--h-md);
    padding: 0 var(--sp-1);
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    cursor: pointer;
  }
  .se-sort button:hover {
    color: var(--text);
  }
  .se-sort button[aria-pressed="true"] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .btn {
    height: var(--h-sm);
    padding: 0 var(--sp-4);
    border: 1px solid var(--border2);
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover {
    background: var(--surface2);
  }
  .btn.primary {
    background: var(--ink, var(--accent));
    border-color: var(--ink, var(--accent));
    color: var(--ink-text, var(--accent-ink));
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .gap {
    margin-top: var(--sp-3);
  }
  .gapb {
    margin-bottom: var(--sp-2);
  }
  .empty {
    margin: 0;
    padding: var(--sp-6) 0;
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font-weight: var(--fw-semi);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .cols {
    display: grid;
    grid-template-columns: var(--g);
    align-items: center;
    gap: var(--sp-3);
    padding: 0 calc(var(--sp-4) + 1px);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .cols button {
    all: unset;
    cursor: pointer;
  }
  .cols button:hover,
  .cols button[aria-pressed="true"] {
    color: var(--text);
  }
  .cols button:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .cols .r {
    text-align: right;
  }
  .card {
    min-width: 0;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .ghead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--sp-3) var(--sp-4);
    background: var(--surface2);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .ghead span:last-child {
    font-family: var(--font-mono);
  }
  .gname {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .sess {
    border-bottom: 1px solid var(--border);
  }
  .sess:last-child {
    border-bottom: 0;
  }
  .row {
    width: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: var(--g);
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: var(--fs-xs);
  }
  .row:hover {
    background: var(--surface2);
  }
  .t {
    min-width: 0;
  }
  .t b {
    display: block;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .id {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .id :global(svg),
  .id :global(img) {
    margin-right: var(--sp-2);
    vertical-align: -2px;
  }
  .muted {
    color: var(--muted);
  }
  .num {
    font-family: var(--font-mono);
    text-align: right;
  }
  .chev {
    display: inline-block;
    color: var(--muted);
    transition: transform 0.12s;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .why {
    display: flex;
    flex-direction: column;
    padding: 0 var(--sp-5) var(--sp-4) 40px;
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
    white-space: nowrap;
  }
  .why :global(button) {
    align-self: flex-start;
    margin-top: var(--sp-3);
  }
  @media (max-width: 760px) {
    .wrap {
      --g: 16px minmax(0, 1fr) 72px;
    }
    .cols,
    .hide {
      display: none;
    }
  }
</style>
