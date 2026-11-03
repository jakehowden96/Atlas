<script lang="ts">
  import type { LiveSession } from "../../../../types/generated/LiveSession";
  import { formatElapsed } from "../../../overview";
  import { contextPercent, modelInfo } from "../../../session-view";
  import { costTodayLine, fmtCost } from "../../../stats-derive";

  interface Props {
    live: LiveSession | null;
    now: number;
  }

  let { live, now }: Props = $props();
  let costSub = $derived(live ? costTodayLine(live) : null);

  let pct = $derived(contextPercent(live?.contextPct ?? 0));
  let model = $derived(modelInfo(live?.model ?? null));
</script>

<div class="meter">
  <div class="line" role="presentation">
    <span class="fill" class:hot={pct > 75} style="width: {pct}%"></span>
  </div>
  <div class="cells">
    <div class="cell">
      <span class="lbl">Context</span>
      <span class="val">{live ? `${pct}%` : "—"}</span>
    </div>
    <div class="cell">
      <span class="lbl">
        {#if model.family}<span class="dot" style="background: var(--model-{model.family})"
          ></span>{/if}{model.name}
      </span>
      <span class="val">{live ? fmtCost(live.costEstimate) : "—"}</span>
      {#if costSub}<span class="lbl">{costSub}</span>{/if}
    </div>
    <div class="cell">
      <span class="lbl">Elapsed</span>
      <span class="val">{(live && formatElapsed(live.startedAt, now)) || "—"}</span>
    </div>
  </div>
</div>

<style>
  .meter {
    background: var(--surface3);
  }

  .line {
    height: 2px;
    background: var(--border2);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .fill.hot {
    background: var(--warn);
  }

  .cells {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 8px;
    padding: 10px 16px 12px;
  }

  .cell {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .lbl {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--fs-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .val {
    font-family: var(--font-mono);
    font-size: var(--fs-md);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    vertical-align: middle;
  }
</style>
