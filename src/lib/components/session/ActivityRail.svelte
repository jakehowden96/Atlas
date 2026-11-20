<script lang="ts">
  import { tick } from "svelte";
  import { chords } from "../../stores/settings";
  import type { SessionTile } from "../../overview";
  import {
    agentsHeadline,
    agentsState,
    headlineText,
    planHeadline,
    planState,
  } from "../../session-view";
  import { railWidth, toggleRail } from "../../stores/view";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import AgentsTile from "./rail/AgentsTile.svelte";
  import PlanTile from "./rail/PlanTile.svelte";
  import PrTile from "./rail/PrTile.svelte";
  import RailHeader from "./rail/RailHeader.svelte";
  import ThinRail, { type ThinMark } from "./rail/ThinRail.svelte";

  interface Props {
    /** The focused session, or null before its first `session-update`. */
    tile: SessionTile | null;
    /** `Date.now()`, ticked once a second by the view, for the elapsed clocks. */
    now: number;
  }

  let { tile, now }: Props = $props();

  let live = $derived(tile?.live ?? null);
  let plan = $derived(live?.plan ?? []);
  let agents = $derived(live?.subagents ?? []);
  let thin = $derived($railWidth === "thin");

  let marks = $derived<ThinMark[]>([
    {
      key: "plan",
      letter: "P",
      state: planState(plan),
      sentence: `Plan: ${headlineText(planHeadline(plan))}`,
    },
    {
      key: "agents",
      letter: "A",
      state: agentsState(agents),
      sentence: `Agents: ${headlineText(agentsHeadline(agents))}`,
    },
    {
      key: "pr",
      letter: "PR",
      state: "idle",
      sentence: "Pull request: no pull request for this branch",
    },
  ]);

  /** Expand the rail and put focus on the tile the mark stood for. */
  async function expandTo(key: ThinMark["key"]) {
    railWidth.set("expanded");
    await tick();
    document.querySelector<HTMLElement>(`.rail [data-tile="${key}"] .head`)?.focus();
  }
</script>

{#snippet toggle()}
  <TooltipButton
    icon={thin ? "right_panel_open" : "right_panel_close"}
    label={thin ? "Expand activity rail" : "Collapse activity rail"}
    shortcut={$chords.toggleRail}
    side="left"
    onclick={toggleRail}
  />
{/snippet}

<aside class="rail" class:thin aria-label="Activity rail">
  {#if thin}
    <div class="fade thin-wrap">
      <div class="bar">{@render toggle()}</div>
      <ThinRail {marks} waiting={tile?.state === "needsYou"} ticketId="" onexpand={expandTo} />
    </div>
  {:else}
    <div class="fade full">
      <RailHeader {tile} {now} actions={toggle} />
      <div class="tiles">
        <PlanTile {plan} workspacePath={tile?.workspacePath} />
        <AgentsTile {agents} worktree={live?.worktree ?? null} {now} />
        <PrTile
          workspacePath={tile?.workspacePath}
          branch={tile?.branch ?? ""}
          prUrl={live?.prUrl ?? null}
          {now}
        />
      </div>
    </div>
  {/if}
</aside>

<style>
  .rail {
    display: flex;
    flex-shrink: 0;
    width: 300px;
    overflow: hidden;
    border-left: 1px solid var(--border);
    background: var(--background);
    animation: atlasSlideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
    transition: width var(--dur-slow) var(--ease-out);
  }

  .rail.thin {
    width: 48px;
  }

  /* The content keeps its own width so it fades in rather than reflowing while
     the rail animates between 300 and 48. */
  .fade {
    animation: railFade var(--dur-instant) var(--ease-out);
  }

  .full {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 300px;
    height: 100%;
  }

  .thin-wrap {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 48px;
  }

  .bar {
    display: flex;
    flex-shrink: 0;
    justify-content: flex-end;
    padding: 4px 8px 0;
  }

  .thin .bar {
    justify-content: center;
    padding: 4px 0 0;
  }

  .tiles {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 12px 8px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  @keyframes railFade {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .fade {
      animation: none;
    }
  }
</style>
