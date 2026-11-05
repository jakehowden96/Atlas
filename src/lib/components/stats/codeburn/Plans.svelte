<script lang="ts">
  import type { BudgetStatus, Quota } from "../../../../types/codeburn-plans";
  import type { Period } from "../../../../types/codeburn";
  import { codeburnAction } from "../../../ipc";
  import { errorMessage } from "../../../ipc-error";
  import { fmtCost, fmtCount } from "../../../stats-derive";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import Progress from "../../ui/Progress.svelte";
  import Select from "../../ui/Select.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Loader from "./Loader.svelte";
  import { PLAN_PRESETS, resetCountdown } from "./plans";

  // The CLI's `status --format json` ignores --period, so it is passed through only to match the other tabs.
  let { period, refresh }: { period: Period; refresh: number } = $props();

  const options = PLAN_PRESETS.map((id) => ({ id, label: id }));
  let preset = $state<string | undefined>(undefined);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let localRefresh = $state(0);
  const now = Date.now();

  async function apply() {
    if (!preset) return;
    saving = true;
    error = null;
    saved = null;
    try {
      await codeburnAction(["plan", "set", preset]);
      saved = preset;
      localRefresh++;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }
</script>

<Loader args={["status", "--format", "json", "--period", period]} refresh={refresh + localRefresh}>
  {#snippet children(s: BudgetStatus)}
    <div class="kpis">
      <div class="card"><Kpi label="Today" value={fmtCost(s.today.cost)} /></div>
      <div class="card"><Kpi label="Today calls" value={fmtCount(s.today.calls)} /></div>
      <div class="card"><Kpi label="This month" value={fmtCost(s.month.cost)} /></div>
      <div class="card"><Kpi label="Month calls" value={fmtCount(s.month.calls)} /></div>
    </div>
  {/snippet}
</Loader>

<Loader args={["quota", "--format", "json"]} refresh={refresh + localRefresh}>
  {#snippet children(q: Quota)}
    {@const shown = q.providers.filter((p) => p.available)}
    <div class="providers">
      {#each shown as p (p.id)}
        <section class="card">
          <h3>{p.name}{p.plan ? ` (${p.plan})` : ""}</h3>
          {#each p.windows as w (w.label)}
            <Progress
              label={`${p.name} ${w.label}`}
              value={w.usedPct}
              count={`${w.usedPct}% used, resets in ${resetCountdown(w.resetsAt, now)}`}
            />
          {:else}
            <p class="muted">No usage windows reported.</p>
          {/each}
        </section>
      {:else}
        <p class="muted">No providers available.</p>
      {/each}
    </div>
  {/snippet}
</Loader>

<section class="card plan">
  <h3>Plan</h3>
  <div class="controls">
    <Select {options} bind:value={preset} placeholder="Choose a plan" aria-label="Plan preset" />
    <Button variant="primary" disabled={!preset} loading={saving} onclick={apply}>Set plan</Button>
  </div>
  {#if error}
    <Banner tone="error" title="Couldn't set plan">{error}</Banner>
  {:else if saved}
    <p class="muted">Plan set to {saved}.</p>
  {/if}
</section>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-3);
  }
  .providers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }
  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .providers {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .card {
    min-width: 0;
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .plan {
    margin-top: var(--sp-3);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-sm);
  }
  .controls {
    display: flex;
    gap: var(--sp-3);
    align-items: center;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
