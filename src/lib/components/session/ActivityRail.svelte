<script lang="ts">
  import { tick } from "svelte";
  import type { SessionTile } from "../../overview";
  import {
    agentsHeadline,
    agentsState,
    headlineText,
    planHeadline,
    planState,
  } from "../../session-view";
  import { railWidth } from "../../stores/view";
  import { closeWith } from "../ui/Modal.svelte";
  import AgentsTile from "./rail/AgentsTile.svelte";
  import PlanTile from "./rail/PlanTile.svelte";
  import PrTile from "./rail/PrTile.svelte";
  import RailHeader from "./rail/RailHeader.svelte";
  import ThinRail, { type ThinMark } from "./rail/ThinRail.svelte";

  interface Props {
    /** Bound to `railOpen`. The rail unmounts itself once the exit run ends. */
    open: boolean;
    /** The focused session, or null before its first `session-update`. */
    tile: SessionTile | null;
    /** `Date.now()`, ticked once a second by the view, for the elapsed clocks. */
    now: number;
  }

  let { open, tile, now }: Props = $props();

  const EXIT_MS = 200;

  // Same delayed-unmount shape as Modal: `visible` lags `open` so the slide-out
  // keyframes finish painting before the node leaves the DOM.
  let visible = $state(false);
  let closing = $state(false);
  /** The pending unmount. A reopen inside the exit window must cancel it, or it
   *  would fire later and hide a panel that is meant to be open. */
  let exitTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (open) {
      clearTimeout(exitTimer);
      visible = true;
      closing = false;
    } else if (visible && !closing) {
      closing = true;
      exitTimer = closeWith(() => {
        visible = false;
        closing = false;
      }, EXIT_MS);
    }
  });

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

{#if visible}
  <aside class="rail" class:closing class:thin aria-label="Activity rail">
    {#if thin}
      <div class="fade thin-wrap">
        <ThinRail
          {marks}
          waiting={tile?.state === "needsYou"}
          ticketId=""
          onexpand={expandTo}
        />
      </div>
    {:else}
      <div class="fade full">
        <RailHeader {tile} {now} />
        <div class="tiles">
          <PlanTile {plan} workspacePath={tile?.workspacePath} />
          <AgentsTile {agents} worktree={live?.worktree ?? null} {now} />
          <PrTile workspacePath={tile?.workspacePath} branch={tile?.branch ?? ""} {now} />
        </div>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .rail {
    display: flex;
    flex-shrink: 0;
    width: 300px;
    overflow: hidden;
    border-left: 1px solid var(--border);
    background: var(--bg);
    animation: atlasSlideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
    transition: width var(--dur-slow) var(--ease-out);
  }

  .rail.thin {
    width: 48px;
  }

  .rail.closing {
    animation: atlasSlideOut 0.2s ease both;
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
    flex-shrink: 0;
    width: 48px;
  }

  .tiles {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    padding: 8px;
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
