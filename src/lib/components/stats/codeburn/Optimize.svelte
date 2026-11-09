<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { OptimizeReport } from "../../../../types/codeburn-optimize";
  import type { Yield, YieldCategory } from "../../../../types/codeburn-yield";
  import { errorMessage } from "../../../ipc-error";
  import { codeburnAction } from "../../../ipc";
  import { fmtCost, fmtTokens } from "../../../stats-derive";
  import { codeburn } from "../../../stores/codeburn";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import Icon from "../../ui/Icon.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import { groupFindings } from "./optimize-groups";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let busy = $state(false);
  let notice = $state<{ tone: "success" | "error"; text: string } | null>(null);
  // Bumped after apply/undo so the report reloads past the shared cache.
  let local = $state(0);

  // Reverts / Abandoned come from `codeburn yield`; a failure just hides those tabs.
  let yieldData = $state<Yield | null>(null);
  $effect(() => {
    const argv = ["yield", "--format", "json", ...filterArgs(filters, "yield")];
    void refresh;
    void local;
    let live = true;
    codeburn<Yield>(argv)
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

  let tab = $state<"waste" | YieldCategory>("waste");
  let open = $state<Record<string, boolean>>({});
  const yieldTabs: { cat: YieldCategory; label: string }[] = [
    { cat: "reverted", label: "Reverts" },
    { cat: "abandoned", label: "Abandoned" },
  ];
  const shownYield = $derived(yieldTabs.filter((t) => yieldData && yieldData.summary[t.cat].sessions > 0));
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

<Loader args={["optimize", "--format", "json", ...filterArgs(filters, "optimize")]} refresh={refresh + local}>
  {#snippet children(r: OptimizeReport)}
    <Card title="Waste">
      {#snippet note()}
        <span class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "waste"} class:on={tab === "waste"} onclick={() => (tab = "waste")}>
            Waste {fmtCost(r.summary.potentialSavingsCostUSD)}
          </button>
          {#each shownYield as t (t.cat)}
            <button role="tab" aria-selected={tab === t.cat} class:on={tab === t.cat} onclick={() => (tab = t.cat)}>
              {t.label} {fmtCost(yieldData?.summary[t.cat].costUSD ?? 0)}
            </button>
          {/each}
        </span>
      {/snippet}

      {#if notice}
        <Banner tone={notice.tone} title={notice.text} ondismiss={() => (notice = null)} />
      {/if}

      {#if tab === "waste"}
        <p class="summary">
          {r.summary.findingCount} findings · {fmtCost(r.summary.potentialSavingsCostUSD)} potential · health {r.summary
            .healthScore}/100
        </p>
        {#each groupFindings(r.findings) as g (g.cls)}
          <div class="ghead">
            <h4>
              {g.title}{g.cls === "fix" ? " (apply-able)" : ""} · {fmtTokens(
                g.items.reduce((n, f) => n + f.tokensSaved, 0),
              )} tokens · {fmtCost(g.items.reduce((n, f) => n + f.estimatedSavingsUSD, 0))} · {g.items.length}
              {g.items.length === 1 ? "finding" : "findings"}
            </h4>
            {#if g.cls === "fix"}
              <span class="actions">
                <Button size="sm" variant="primary" disabled={busy} onclick={apply}>Apply fixes</Button>
                <Button size="sm" disabled={busy} onclick={() => run(["act", "undo", "--last"], "Undone")}>
                  Undo last
                </Button>
              </span>
            {/if}
          </div>
          {#each g.items as f (f.id)}
            <button class="row" aria-expanded={!!open[f.id]} onclick={() => (open[f.id] = !open[f.id])}>
              <span class="pill {f.severity}">{f.severity}</span>
              <span class="title">{f.title}</span>
              <span class="save">
                <b>{fmtCost(f.estimatedSavingsUSD)}</b>
                {fmtTokens(f.tokensSaved)} tokens · {f.basis}
              </span>
              <span class="chev" class:turned={open[f.id]}><Icon name="chevron_right" size={16} /></span>
            </button>
            {#if open[f.id]}
              <div class="detail">
                <p>{f.explanation}</p>
                {#if f.fix}
                  <p class="fixlabel">{f.fix.label}</p>
                  <pre>{f.fix.text}</pre>
                {/if}
                {#if f.class === "fix"}
                  <div class="actions">
                    <Button size="sm" disabled={busy} onclick={() => applyOne(f.id)}>Apply</Button>
                    <Button size="sm" disabled={busy} onclick={() => run(["act", "undo", "--last"], "Undone")}>
                      Undo last
                    </Button>
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        {:else}
          <p>No findings for this period.</p>
        {/each}
      {:else}
        <table class="cb-table">
          <thead>
            <tr><th>Project</th><th class="num">Commits</th><th class="num">Cost</th></tr>
          </thead>
          <tbody>
            {#each tabRows as d (d.sessionId)}
              <tr><td>{d.project}</td><td class="num">{d.commitCount}</td><td class="num">{fmtCost(d.costUSD)}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Card>
  {/snippet}
</Loader>

<style>
  .tabs {
    display: inline-flex;
    gap: var(--sp-3);
  }
  .tabs button {
    padding: var(--sp-1) 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    color: var(--text);
  }
  .summary {
    margin: 0 0 var(--sp-3);
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .ghead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }
  h4 {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    text-transform: uppercase;
  }
  .actions {
    display: flex;
    gap: var(--sp-2);
  }
  .row {
    display: grid;
    grid-template-columns: 5.5rem 1fr auto auto;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-2) 0;
    border: 0;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .title {
    font-weight: var(--fw-semi);
  }
  .save {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
  .save b {
    color: var(--success, var(--accent));
    font-weight: var(--fw-semi);
  }
  .chev {
    display: inline-flex;
    color: var(--muted);
    transition: transform 0.15s;
  }
  .chev.turned {
    transform: rotate(90deg);
  }
  .pill {
    justify-self: start;
    padding: 0 var(--sp-2);
    border-radius: var(--r-pill);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    text-transform: capitalize;
  }
  .pill.high {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }
  .pill.medium {
    background: color-mix(in srgb, var(--warn) 20%, transparent);
    color: var(--warn);
  }
  .pill.low {
    background: var(--surface3);
    color: var(--muted);
  }
  .detail {
    padding: 0 0 var(--sp-3) calc(5.5rem + var(--sp-3));
    font-size: var(--fs-xs);
  }
  .detail p {
    margin: 0 0 var(--sp-2);
  }
  .fixlabel {
    color: var(--muted);
  }
  pre {
    white-space: pre-wrap;
    margin: 0 0 var(--sp-2);
  }
</style>
