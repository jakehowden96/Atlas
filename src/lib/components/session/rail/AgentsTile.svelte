<script lang="ts">
  import type { Subagent } from "../../../../types/generated/Subagent";
  import {
    agentRows,
    agentsDetail,
    agentsHeadline,
    agentsState,
    spansWorktrees,
  } from "../../../session-view";
  import HeadlineText from "./HeadlineText.svelte";
  import RailGroup from "./RailGroup.svelte";
  import Tile from "./Tile.svelte";

  interface Props {
    agents: Subagent[];
    /** The session's own worktree, to tell whether agents span more than one. */
    worktree: string | null;
    now: number;
  }

  let { agents, worktree, now }: Props = $props();

  let head = $derived(agentsHeadline(agents));
  let rows = $derived(agentRows(agents, now, spansWorktrees(worktree, agents)));
</script>

<Tile key="agents" label="Agents" state={agentsState(agents)}>
  {#snippet headline()}
    <HeadlineText h={head} restMuted />
  {/snippet}
  {#snippet detail()}
    {agentsDetail(agents)}
  {/snippet}
  {#snippet children()}
    {#if agents.length === 0}
      <span class="none">No agents yet</span>
    {:else}
      <RailGroup rows={rows.running} noun="running" />
      <RailGroup rows={rows.done} fold="done" />
    {/if}
  {/snippet}
</Tile>

<style>
  .none {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
</style>
