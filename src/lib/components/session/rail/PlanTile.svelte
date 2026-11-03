<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import type { PlanEntry } from "../../../../types/generated/PlanEntry";
  import type { PlanItem } from "../../../../types/generated/PlanItem";
  import { planWorkspace } from "../../../files";
  import {
    planHeadline,
    planOpenHeadline,
    planProgress,
    planRows,
    planState,
  } from "../../../session-view";
  import { fileWs, loadPlans, openFile, plans } from "../../../stores/files";
  import { showView } from "../../../stores/view";
  import { visibleWorkspaces } from "../../../stores/workspace";
  import HeadlineText from "./HeadlineText.svelte";
  import RailGroup from "./RailGroup.svelte";
  import Tile from "./Tile.svelte";

  interface Props {
    plan: PlanItem[];
    workspacePath: string | undefined;
  }

  let { plan, workspacePath }: Props = $props();

  let state = $derived(planState(plan));
  let head = $derived(planHeadline(plan));
  let rows = $derived(planRows(plan));

  // Plan files are read by the Files screen and the ⌘K palette; whichever gets
  // there first fills the store, and on a session-first visit that is the rail.
  onMount(() => {
    if (get(plans).length === 0) void loadPlans();
  });

  /**
   * The plan file this session's workspace owns, newest first, or null when
   * Claude has never written one for it. With none there is nothing to open,
   * so the link is not drawn: a muted disabled link read as a broken one.
   *
   * A plan is named after a slugified cwd, not a session, so a workspace's
   * sessions all share its plans; the most recent one is the live plan.
   */
  let planFile = $derived.by<PlanEntry | null>(() => {
    const ws = workspacePath;
    if (!ws) return null;
    let best: PlanEntry | null = null;
    for (const entry of $plans) {
      if (planWorkspace(entry, $visibleWorkspaces) !== ws) continue;
      if (!best || (entry.modified ?? "") > (best.modified ?? "")) best = entry;
    }
    return best;
  });

  function openPlan() {
    if (!planFile || !workspacePath) return;
    fileWs.set(workspacePath);
    openFile("plans", planFile.path);
    showView("files");
  }
</script>

<Tile key="plan" label="Plan" {state}>
  {#snippet headline(open: boolean)}
    {#if open && plan.length > 0}
      <span>{planOpenHeadline(plan)}</span>
    {:else}
      <HeadlineText h={head} />
    {/if}
  {/snippet}
  {#snippet detail()}
    {#if plan.length > 0}
      <div class="track"><span class="fill" style="width: {planProgress(plan) * 100}%"></span></div>
    {/if}
  {/snippet}
  {#snippet children()}
    {#if plan.length === 0}
      <span class="none">No plan yet</span>
    {:else}
      <RailGroup rows={rows.running} />
      <RailGroup rows={rows.next} noun="next" />
      <RailGroup rows={rows.done} fold="done" />
    {/if}
    {#if planFile}
      <button type="button" class="open-plan" onclick={openPlan}>Open plan file →</button>
    {/if}
  {/snippet}
</Tile>

<style>
  .track {
    height: 2px;
    margin-top: 2px;
    background: var(--surface3);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--muted);
  }

  .none {
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  .open-plan {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  .open-plan:hover {
    color: var(--text);
  }
</style>
