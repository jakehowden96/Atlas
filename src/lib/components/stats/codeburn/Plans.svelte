<script lang="ts">
  import type { BudgetStatus, Quota } from "../../../../types/codeburn-plans";
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import { codeburnAction } from "../../../ipc";
  import { errorMessage } from "../../../ipc-error";
  import { fmtCost } from "../../../stats-derive";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import Progress from "../../ui/Progress.svelte";
  import Select from "../../ui/Select.svelte";
  import Kpi from "../charts/Kpi.svelte";
  import Card from "./Card.svelte";
  import Loader from "./Loader.svelte";
  import { PLAN_PRESETS, resetCountdown } from "./plans";

    let { filters, refresh }: { filters: Filters; refresh: number } = $props();

  const options = PLAN_PRESETS.map((id) => ({ id, label: id }));
  let preset = $state<string | undefined>(undefined);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let localRefresh = $state(0);
  const now = Date.now();
  const today = new Date(now);
  const projected = (mtd: number) =>
    (mtd / today.getDate()) * new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

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

<Loader args={["status", "--format", "json", ...filterArgs(filters, "status")]} refresh={refresh + localRefresh}>
  {#snippet children(s: BudgetStatus)}
    <div class="kpis">
      <div class="tile"><Kpi label="Month to date" value={fmtCost(s.month.cost)} /></div>
      <div class="tile"><Kpi label="Projected month" value={fmtCost(projected(s.month.cost))} /></div>
      <div class="tile"><Kpi label="Budget" value="—" /></div>
    </div>
  {/snippet}
</Loader>

<Loader args={["quota", "--format", "json"]} refresh={refresh + localRefresh}>
  {#snippet children(q: Quota)}
    {@const shown = q.providers.filter((p) => p.available)}
    <div class="providers">
      {#each shown as p (p.id)}
        <Card title={p.name} note={p.plan}>
          <div class="windows">
            {#each p.windows as w (w.label)}
              <div class="win">
                <span>{w.label} <span class="muted">resets in {resetCountdown(w.resetsAt, now)}</span></span>
                <Progress thresholds label={`${p.name} ${w.label}`} value={w.usedPct} count={`${w.usedPct}%`} />
              </div>
            {:else}
              <p class="muted">No usage windows reported.</p>
            {/each}
          </div>
        </Card>
      {:else}
        <p class="muted">No providers available.</p>
      {/each}
    </div>
  {/snippet}
</Loader>

<div class="plan">
<Card title="Plan">
  <div class="controls">
    <Select {options} bind:value={preset} placeholder="Choose a plan" aria-label="Plan preset" />
    <Button variant="primary" disabled={!preset} loading={saving} onclick={apply}>Set plan</Button>
  </div>
  {#if error}
    <Banner tone="error" title="Couldn't set plan">{error}</Banner>
  {:else if saved}
    <p class="muted">Plan set to {saved}.</p>
  {/if}
</Card>
</div>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-3);
  }
  .providers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }
  @media (max-width: 1100px) {
    .providers {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .tile {
    min-width: 0;
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .windows {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .win {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    font-size: var(--fs-xs);
  }
  .plan {
    margin-top: var(--sp-3);
  }
  .plan :global(.body) {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
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
