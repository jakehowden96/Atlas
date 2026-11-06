<script lang="ts">
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import type { OptimizeReport } from "../../../../types/codeburn-optimize";
  import { errorMessage } from "../../../ipc-error";
  import { codeburnAction } from "../../../ipc";
  import { fmtCost, fmtTokens } from "../../../stats-derive";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";
  import { groupFindings } from "./optimize-groups";

  let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  let busy = $state(false);
  let notice = $state<{ tone: "success" | "error"; text: string } | null>(null);
  // Bumped after apply/undo so the report reloads past the shared cache.
  let local = $state(0);

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
    <div class="kpis">
      <div class="card"><Kpi label="Grade" value={`${r.summary.healthGrade} (${r.summary.healthScore})`} /></div>
      <div class="card"><Kpi label="Findings" value={String(r.summary.findingCount)} /></div>
      <div class="card">
        <Kpi
          label="Potential savings"
          value={`${fmtCost(r.summary.potentialSavingsCostUSD)} (${r.summary.potentialSavingsPercent}%)`}
        />
      </div>
    </div>

    <div class="actions">
      <Button variant="primary" disabled={busy || r.findings.length === 0} onclick={apply}>Apply fixes</Button>
      <Button disabled={busy} onclick={() => run(["act", "undo", "--last"], "Undone")}>Undo last</Button>
    </div>

    {#if notice}
      <Banner tone={notice.tone} title={notice.text} ondismiss={() => (notice = null)} />
    {/if}

    {#each groupFindings(r.findings) as g (g.cls)}
      <section>
        <h3>{g.title}</h3>
        {#each g.items as f (f.id)}
          <article class="card finding">
            <header>
              <strong>{f.title}</strong>
              <span class="save">
                {fmtCost(f.estimatedSavingsUSD)} / {fmtTokens(f.tokensSaved)} ({f.basis})
              </span>
            </header>
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
          </article>
        {/each}
      </section>
    {:else}
      <p>No findings for this period.</p>
    {/each}
  {/snippet}
</Loader>

<style>
  .kpis,
  .actions {
    display: flex;
    gap: var(--sp-3);
    margin-bottom: var(--sp-3);
    flex-wrap: wrap;
  }
  .finding {
    margin-bottom: var(--sp-2);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
  }
  .save,
  .fixlabel {
    color: var(--text-muted, inherit);
  }
  pre {
    white-space: pre-wrap;
    margin: 0;
  }
</style>
