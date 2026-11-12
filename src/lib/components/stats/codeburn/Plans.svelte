<script lang="ts">
  import type { BudgetStatus, Quota } from "../../../../types/codeburn-plans";
  import { filterArgs, type Filters } from "../../../../types/codeburn";
  import { codeburnAction } from "../../../ipc";
  import { errorMessage } from "../../../ipc-error";
  import { fmtCost } from "../../../stats-derive";
  import { tooltip } from "../../../ui/tooltip";
  import Banner from "../../ui/Banner.svelte";
  import Button from "../../ui/Button.svelte";
  import Progress from "../../ui/Progress.svelte";
  import Select from "../../ui/Select.svelte";
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

<div class="page">
  <Loader
    args={["status", "--format", "json", ...filterArgs(filters, "status")]}
    refresh={refresh + localRefresh}
  >
    {#snippet children(s: BudgetStatus)}
      <div class="g3">
        <div class="kpi">
          <div class="k">Month to date</div>
          <div class="v">{fmtCost(s.month.cost)}</div>
          <div class="n">API-equivalent</div>
        </div>
        <div class="kpi">
          <div class="k">Projected month</div>
          <div class="v">{fmtCost(projected(s.month.cost))}</div>
          <div class="n">at current pace</div>
        </div>
        <div class="kpi">
          <div class="k">Budget</div>
          <div class="v">—</div>
        </div>
      </div>
    {/snippet}
  </Loader>

  <Loader args={["quota", "--format", "json"]} refresh={refresh + localRefresh}>
    {#snippet children(q: Quota)}
      {@const shown = q.providers.filter((p) => p.available)}
      {#each shown as p (p.id)}
        <Card title={p.name} note={p.plan}>
          {#each p.windows as w (w.label)}
            <div class="live-row">
              <span
                >{w.label}
                <span class="muted">resets in {resetCountdown(w.resetsAt, now)}</span></span
              >
              <div use:tooltip={{ text: `${w.label} ${w.usedPct}% used`, delay: 0, side: "top" }}>
                <Progress
                  thick
                  thresholds
                  label={`${p.name} ${w.label}`}
                  value={w.usedPct}
                  count={`${w.usedPct}%`}
                />
              </div>
            </div>
          {:else}
            <p class="muted">No usage windows reported.</p>
          {/each}
        </Card>
      {:else}
        <p class="muted">No providers available.</p>
      {/each}
    {/snippet}
  </Loader>

  <Card title="Plan">
    <div class="controls">
      <div class="sel">
        <Select
          {options}
          bind:value={preset}
          placeholder="Choose a plan"
          aria-label="Plan preset"
        />
      </div>
      <Button variant="primary" disabled={!preset} loading={saving} onclick={apply}>Set plan</Button
      >
    </div>
    {#if error}
      <Banner tone="error" title="Couldn't set plan">{error}</Banner>
    {:else if saved}
      <p class="muted">Plan set to {saved}.</p>
    {/if}
  </Card>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .g3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  @media (max-width: 520px) {
    .g3 {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .kpi {
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .k {
    font-size: var(--fs-2xs);
    font-weight: var(--fw-semi);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .v {
    margin-top: var(--sp-1);
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    font-weight: var(--fw-semi);
    font-variant-numeric: tabular-nums;
  }
  .n {
    margin-top: var(--sp-1);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .live-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-1) 0;
    font-size: var(--fs-xs);
  }
  .controls {
    display: flex;
    gap: var(--sp-3);
    align-items: center;
  }
  .sel {
    width: 240px;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
