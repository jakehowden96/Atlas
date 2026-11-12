<script lang="ts">
  import { untrack } from "svelte";
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { OptimizeReport } from "../../../../types/codeburn-optimize";
  import type { Yield, YieldCategory } from "../../../../types/codeburn-yield";
  import { errorMessage } from "../../../ipc-error";
  import { codeburnAction } from "../../../ipc";
  import { fmtCost, fmtTokens } from "../../../stats-derive";
  import { codeburn } from "../../../stores/codeburn";
  import { tooltip } from "../../../ui/tooltip";
  import Banner from "../../ui/Banner.svelte";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import { groupFindings } from "./optimize-groups";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let busy = $state(false);
  let notice = $state<{ tone: "success" | "error"; text: string } | null>(null);
  // Bumped after apply/undo so the report reloads past the shared cache.
  let local = $state(0);

  // Reverts / Abandoned come from `codeburn yield`; a failure just leaves them at $0.00.
  let yieldData = $state<Yield | null>(null);
  let seen = untrack(() => refresh + local);
  $effect(() => {
    const argv = ["yield", "--format", "json", ...filterArgs(filters, "yield")];
    // Refresh and apply/undo skip the cache, as the Loaders below do.
    const fresh = refresh + local !== seen;
    seen = refresh + local;
    let live = true;
    codeburn<Yield>(argv, fresh)
      .then((y) => {
        if (live) yieldData = y;
      })
      .catch(() => {
        if (live) yieldData = null;
      });
    return () => {
      live = false;
    };
  });

  // Severity -> pill tone + arrow, as in the design's OPSEV.
  const SEV: Record<string, [string, string]> = {
    high: ["bad", "↑"],
    medium: ["warn", "→"],
    low: ["neutral", "↓"],
  };
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const asOf = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  let tab = $state<"waste" | YieldCategory>("waste");
  let open = $state<Record<string, boolean>>({});
  const yieldTabs: { cat: YieldCategory; label: string }[] = [
    { cat: "reverted", label: "Reverts" },
    { cat: "abandoned", label: "Abandoned" },
  ];
  const tabRows = $derived((yieldData?.details ?? []).filter((d) => d.category === tab));

  async function run(args: string[], done: string) {
    busy = true;
    notice = null;
    try {
      const out = await codeburnAction(args);
      notice = { tone: "success", text: `${done}${out.trim() ? `: ${out.trim()}` : ""}` };
      local++;
    } catch (e) {
      notice = { tone: "error", text: errorMessage(e) };
    } finally {
      busy = false;
    }
  }

  async function applyOne(id: string) {
    await run(["optimize", "--apply", "--yes", "--only", id], "Applied");
  }

  async function apply() {
    const ok = await confirmAction({
      title: "Apply optimizations?",
      body: "This edits your Claude configuration. You can undo the last change afterwards.",
      confirmLabel: "Apply",
    });
    if (ok) await run(["optimize", "--apply", "--yes"], "Applied");
  }
</script>

<Loader
  args={["optimize", "--format", "json", ...filterArgs(filters, "optimize")]}
  refresh={refresh + local}
>
  {#snippet children(r: OptimizeReport)}
    <Card title="Waste · as of {asOf}">
      {#snippet note()}
        <span class="seg" role="tablist">
          <button role="tab" aria-selected={tab === "waste"} onclick={() => (tab = "waste")}>
            Waste {fmtCost(r.summary.potentialSavingsCostUSD)}
          </button>
          {#each yieldTabs as t (t.cat)}
            <button role="tab" aria-selected={tab === t.cat} onclick={() => (tab = t.cat)}>
              {t.label}
              {fmtCost(yieldData?.summary[t.cat].costUSD ?? 0)}
            </button>
          {/each}
        </span>
      {/snippet}

      {#if notice}
        <Banner tone={notice.tone} title={notice.text} ondismiss={() => (notice = null)} />
      {/if}

      {#if tab === "waste"}
        <div class="op-sum">
          <p class="sub">
            {r.summary.findingCount} findings · {fmtCost(r.summary.potentialSavingsCostUSD)} potential
          </p>
          <div
            class="hb"
            use:tooltip={{ text: `Health ${r.summary.healthScore}/100`, delay: 0, side: "top" }}
          >
            <span class="name">Health</span>
            <span class="t"
              ><span
                class="f"
                class:warn={r.summary.healthScore < 50}
                style:width="{Math.min(100, r.summary.healthScore)}%"
              ></span></span
            >
            <span class="val">{r.summary.healthScore}/100</span>
          </div>
        </div>
        {#each groupFindings(r.findings) as g (g.cls)}
          {@const todo = g.cls === "fix" ? g.items.filter((f) => f.fix).length : 0}
          <div class="op-gh">
            <h4>
              {g.title}{g.cls === "fix" ? " (apply-able)" : ""} · {fmtTokens(
                g.items.reduce((n, f) => n + f.tokensSaved, 0),
              )} tokens · {fmtCost(g.items.reduce((n, f) => n + f.estimatedSavingsUSD, 0))} · {g
                .items.length}
              {g.items.length === 1 ? "finding" : "findings"}
            </h4>
            {#if g.cls === "fix"}
              <span class="actions">
                <button class="btn primary" type="button" disabled={busy} onclick={apply}>
                  Apply all {todo || g.items.length}
                </button>
                <button
                  class="btn"
                  type="button"
                  disabled={busy}
                  onclick={() => run(["act", "undo", "--last"], "Undone")}
                >
                  Undo last
                </button>
              </span>
            {/if}
          </div>
          {#each g.items as f (f.id)}
            <div class="sess">
              <button
                class="op-r"
                aria-expanded={!!open[f.id]}
                onclick={() => (open[f.id] = !open[f.id])}
              >
                <span class="pill {SEV[f.severity]?.[0] ?? 'neutral'}"
                  >{SEV[f.severity]?.[1]} {cap(f.severity)}</span
                >
                <b>{f.title}</b>
                <span class="op-v">
                  <span class="good mono">{fmtCost(f.estimatedSavingsUSD)}</span>
                  <span class="muted mono">{fmtTokens(f.tokensSaved)} tokens · {f.basis}</span>
                  <span class="op-ch" aria-hidden="true">›</span>
                </span>
              </button>
              {#if open[f.id]}
                <div class="op-why">
                  <p class="sub">{f.explanation}</p>
                  <div class="kv">
                    <span>Projected saving</span>
                    <span>{fmtCost(f.estimatedSavingsUSD)} · {fmtTokens(f.tokensSaved)} tokens</span
                    >
                  </div>
                  <p class="sub">
                    {f.basis === "measured"
                      ? "Measured: counted directly from the logged sessions. This is what these sessions actually used."
                      : "Estimated: modelled from your usage pattern. The real saving depends on how often this recurs, so check the next period."}
                  </p>
                  {#if f.fix}
                    <p class="sub fixlabel">{f.fix.label}</p>
                  {/if}
                  {#if f.fix || f.class === "fix"}
                    <div class="fix">
                      {#if f.fix}
                        <code>{f.fix.text}</code>
                        <button
                          class="btn"
                          type="button"
                          onclick={() => navigator.clipboard?.writeText(f.fix?.text ?? "")}
                        >
                          Copy command
                        </button>
                      {/if}
                      {#if f.class === "fix"}
                        <button
                          class="btn primary"
                          type="button"
                          disabled={busy}
                          onclick={() => applyOne(f.id)}
                        >
                          Apply
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        {:else}
          <p class="empty">Nothing left to fix.</p>
        {/each}
      {:else if tabRows.length === 0}
        <p class="empty">
          {tab === "reverted"
            ? "No reverted work found in this range. Reverts show up when edits are undone or a commit is reset within the same session."
            : "No abandoned sessions in this range."}
        </p>
      {:else}
        <table class="cb-table">
          <thead>
            <tr><th>Project</th><th class="num">Commits</th><th class="num">Cost</th></tr>
          </thead>
          <tbody>
            {#each tabRows as d (d.sessionId)}
              <tr
                ><td>{d.project}</td><td class="num">{d.commitCount}</td><td class="num"
                  >{fmtCost(d.costUSD)}</td
                ></tr
              >
            {/each}
          </tbody>
        </table>
      {/if}
    </Card>
  {/snippet}
</Loader>

<style>
  .seg {
    display: inline-flex;
    gap: 2px;
    max-width: 100%;
    padding: 2px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface2);
  }
  .seg button {
    height: var(--h-sm);
    padding: 0 var(--sp-4);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--text);
  }
  .seg button[aria-selected="true"] {
    border-color: var(--border2);
    background: var(--surface);
    color: var(--text);
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .empty {
    padding: var(--sp-7) 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    text-align: center;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--muted);
  }
  .good {
    color: var(--accent);
    font-weight: var(--fw-semi);
  }
  .op-sum {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin: var(--sp-3) 0 var(--sp-2);
  }
  .hb {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-1) 0;
    font-size: var(--fs-xs);
  }
  .hb .t {
    height: 8px;
    border-bottom: 1px solid var(--border2);
  }
  .hb .f {
    display: block;
    height: 100%;
    border-radius: 0 var(--r-xs) var(--r-xs) 0;
    background: var(--accent);
  }
  .hb .f.warn {
    background: var(--warn);
  }
  .hb .val {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .op-gh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
  }
  h4 {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .actions {
    display: flex;
    gap: var(--sp-2);
  }
  .btn {
    height: var(--h-sm);
    padding: 0 var(--sp-4);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--surface2);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn.primary {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--ink-text);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--ink-hover-bg);
  }
  .sess {
    border-bottom: 1px solid var(--border);
  }
  .sess:last-child {
    border-bottom: 0;
  }
  .op-r {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sp-4);
    width: 100%;
    padding: var(--sp-3) var(--sp-2);
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .op-r:hover {
    background: var(--surface2);
  }
  .op-r b {
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
  }
  .op-v {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-2xs);
    white-space: nowrap;
  }
  .op-ch {
    display: inline-block;
    color: var(--muted);
    transition: transform 0.12s;
  }
  .op-r[aria-expanded="true"] .op-ch {
    transform: rotate(90deg);
  }
  .op-why {
    padding: 0 var(--sp-2) var(--sp-4) 112px;
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
    font-variant-numeric: tabular-nums;
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .fixlabel {
    margin-top: var(--sp-3);
  }
  .fix {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }
  .fix code {
    padding: var(--sp-1) var(--sp-3);
    overflow-wrap: anywhere;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface2);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    justify-self: start;
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
  .pill.warn {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .pill.bad {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }
  .pill.neutral {
    background: var(--surface3);
    color: var(--muted);
  }
</style>
