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
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
</script>

<Loader args={["sessions", "--format", "json", ...filterArgs(filters, "sessions"), "--contributions"]} {refresh}>
  {#snippet children(rows: SessionRow[])}
    {#if rows.length === 0}
      <EmptyState icon="folder" title="No sessions in this period" />
    {:else}
      {@const list = visible(rows)}
      <div class="wrap">
        <div class="tabs" role="radiogroup" aria-label="Provider">
          {#each ["all", ...providers(rows)] as id (id)}
            <button
              type="button"
              role="radio"
              aria-checked={provider === id}
              class:on={provider === id}
              onclick={() => (provider = id)}
            >
              {#if id !== "all"}<ConnectorLogo connector={id} size={16} />{/if}
              <span class="cap">{id === "all" ? "All" : id}</span>
              <span class="n">{id === "all" ? rows.length : rows.filter((r) => r.provider === id).length}</span>
            </button>
          {/each}
        </div>
        <div class="bar">
          <input
            type="search"
            placeholder="Search project, model, or id…"
            aria-label="Search sessions"
            bind:value={query}
          />
          <div class="sorts" role="group" aria-label="Sort">
            {#each SORTS as s (s.key)}
              <button type="button" aria-pressed={key === s.key} onclick={() => (key = s.key)}>{s.label}</button>
            {/each}
          </div>
          <button type="button" class="pill" aria-pressed={group} onclick={() => (group = !group)}>
            Group by provider
          </button>
        </div>
        <p class="sub">
          {plural(list.length, "session")}{rows.some((r) => r.helperCount !== undefined)
            ? ` + ${plural(sum(list, (r) => r.helperCount ?? 0), "subagent")}`
            : ""}
          · {fmtCost(sum(list, (r) => r.cost))} · {fmtTokens(sum(list, (r) => r.outputTokens))} tokens
        </p>
        {#if list.length === 0}
          <p class="sub">
            No sessions match{query ? ` “${query}”` : ""}.
            {#if query}<button type="button" class="link" onclick={() => (query = "")}>Clear search</button>{/if}
          </p>
        {:else}
          <div class="list">
            {#each group ? providers(list) : [null] as g (g ?? "")}
              {@const rs = g ? list.filter((r) => r.provider === g) : list}
              {#if g}
                <div class="ghead">
                  <span class="gname"><ConnectorLogo connector={g} size={16} />{g}</span>
                  <span>{plural(rs.length, "session").toUpperCase()}</span>
                  <span>{fmtCost(sum(rs, (r) => r.cost))}</span>
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
                        {r.sessionId}{r.helperCount ? ` · ${plural(r.helperCount, "subagent")}` : ""}
                      </span>
                    </span>
                    <span class="muted">{day(r.startedAt)}</span>
                    <span>{r.models[0] ?? "—"}</span>
                    <span class="num">{fmtCount(r.turns)}</span>
                    <span class="num">{fmtCost(r.cost)}</span>
                    <span class="num">{fmtTokens(r.outputTokens)}</span>
                  </button>
                  {#if open === r.sessionId}
                    <div class="why">
                      <Loader args={["sessions", "--id", r.sessionId, "--why", "--format", "json"]} {refresh}>
                        {#snippet children(why: SessionWhy)}
                          <p class="sub">
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
            {/each}
          </div>
        {/if}
        <p class="sub">Showing {list.length} of {inTab(rows).length} top-level sessions</p>
      </div>
    {/if}
  {/snippet}
</Loader>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    max-width: 1000px;
    margin: 0 auto;
  }
  .tabs,
  .bar,
  .sorts {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .bar {
    gap: var(--sp-3);
  }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2);
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    color: var(--text);
    font-weight: var(--fw-semi);
  }
  .cap {
    text-transform: capitalize;
  }
  .n {
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  input {
    min-width: 220px;
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: var(--fs-xs);
  }
  .sorts button {
    padding: var(--sp-1) var(--sp-2);
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .sorts button[aria-pressed="true"] {
    border-bottom-color: var(--accent);
    color: var(--text);
  }
  .pill {
    padding: var(--sp-1) var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    font-size: var(--fs-xs);
  }
  .pill[aria-pressed="true"] {
    border-color: var(--accent);
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  .gap {
    margin-top: var(--sp-3);
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
  }
  .list {
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    overflow: hidden;
  }
  .ghead {
    display: flex;
    gap: var(--sp-4);
    padding: var(--sp-2) var(--sp-4);
    background: color-mix(in srgb, var(--surface) 90%, black);
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.05em;
  }
  .gname {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    margin-right: auto;
    text-transform: uppercase;
  }
  .sess + .sess,
  .ghead + .sess {
    border-top: 1px solid var(--border);
  }
  .row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) 64px 110px 40px 64px 64px;
    gap: var(--sp-3);
    align-items: center;
    width: 100%;
    padding: var(--sp-2) var(--sp-4);
    font-size: var(--fs-xs);
  }
  .row:hover {
    background: var(--surface2, var(--surface));
  }
  .t {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .t b {
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .id,
  .muted {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .num {
    font-family: var(--font-mono);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .chev {
    color: var(--muted);
    transition: transform 0.1s;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .why {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    align-items: flex-start;
    padding: var(--sp-2) var(--sp-4) var(--sp-3) calc(var(--sp-4) + 16px + var(--sp-3));
    font-size: var(--fs-xs);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-4);
    width: 100%;
  }
  .kv span:last-child {
    color: var(--muted);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
</style>
