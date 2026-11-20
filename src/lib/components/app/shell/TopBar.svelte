<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import Popover from "../common/AnchoredPopover.svelte";
  import Segmented, { type Segment } from "$lib/components/app/common/Segmented.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import NotificationsPanel, { unreadNotificationCount } from "./NotificationsPanel.svelte";
  import StatusChips, { statusChipCount } from "./StatusChips.svelte";
  import { isMacPlatform } from "../../../platform";
  import { TODAY_COST_TIP } from "../../../stats-derive";
  import { todayCost } from "../../../stores/cost";
  import { dirtyFiles } from "../../../stores/files";
  import { liveTiles } from "../../../stores/liveTiles";
  import { prsAttentionCount } from "../../../stores/prs";
  import { chords, settingsOpen } from "../../../stores/settings";
  import { activeView, jumpOpen, openNewSession, showView, type View } from "../../../stores/view";
  import { statusParts, topBarTier, type StatusPart } from "../../../topbar";

  // macOS keeps the overlay title bar, so this bar is the drag region and
  // leaves room for the traffic lights. Windows draws a native title bar above.
  const mac = isMacPlatform();

  // Top-bar status, off the same tiles the Sessions grid builds. Not off
  // `$liveSessionList`: Claude Code's tail never reports `needsYou` (the
  // transcript cannot see a permission prompt); the Notification hook's flag is
  // folded in by `buildTiles`, so counting anywhere else counts the wrong thing.
  let needsYou = $derived($liveTiles.filter((t) => t.state === "needsYou").length);
  let running = $derived($liveTiles.filter((t) => t.state === "running").length);
  let idle = $derived($liveTiles.filter((t) => t.state === "idle").length);
  // Today's spend is codeburn's figure; the cost store refreshes itself.
  let spend = $derived($todayCost);

  // The Pull requests badge counts PRs asking for action; at zero it is left off.
  let viewOptions = $derived<Segment<View>[]>([
    { id: "sessions", label: "Sessions", count: $liveTiles.length },
    { id: "files", label: "Files", dot: $dirtyFiles.size > 0 },
    {
      id: "prs",
      label: "Pull requests",
      count: $prsAttentionCount > 0 ? $prsAttentionCount : undefined,
      alert: true,
    },
    { id: "stats", label: "Stats" },
  ]);

  let width = $state(1400);
  let tier = $derived(topBarTier(width));
  let parts = $derived(statusParts(tier, { running, needsYou, idle, spend }));
  // The compact chip expands to the full line in a popover.
  let allParts = $derived(statusParts("full", { running, needsYou, idle, spend }));

  let chip = $state<HTMLElement>();
  let chipOpen = $state(false);

  let bell = $state<HTMLElement>();
  let bellOpen = $state(false);
  // Under 800px the status chips fold into the bell menu.
  let collapsed = $derived(width < 800);
  let bellCount = $derived($unreadNotificationCount + (collapsed ? $statusChipCount : 0));

  // The text itself pulses while its count is non-zero.
  function live(p: StatusPart) {
    return (p.kind === "running" && running > 0) || (p.kind === "needsYou" && needsYou > 0);
  }
</script>

{#snippet line(list: StatusPart[])}
  {#each list as p, i (p.kind)}
    {#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}
    <span class="part" class:needs={p.kind === "needsYou"} class:live={live(p)}>
      {#if p.kind === "spend"}
        <Tooltip.Root
          ><Tooltip.Trigger
            >{#snippet child({ props })}<span {...props} class="inline-flex min-w-0">{p.text}</span
              >{/snippet}</Tooltip.Trigger
          ><Tooltip.Content>{TODAY_COST_TIP}</Tooltip.Content></Tooltip.Root
        >
      {:else}
        {p.text}
      {/if}
    </span>
  {/each}
{/snippet}

<header class="topbar" class:mac data-tauri-drag-region bind:clientWidth={width}>
  <!-- Session is a detail view Sessions opens in place, not a tab of its own,
       so Sessions stays lit while it is showing. -->
  <Segmented
    options={viewOptions}
    value={$activeView === "session" ? "sessions" : $activeView}
    onChange={(id) => showView(id)}
    label="Views"
  />

  <div class="spacer" data-tauri-drag-region></div>

  <div class="slot" data-slot="chips">
    {#if !collapsed}<StatusChips />{/if}
  </div>

  {#if tier === "compact"}
    <button
      bind:this={chip}
      type="button"
      class="chip"
      aria-haspopup="dialog"
      aria-expanded={chipOpen}
      aria-label="Session status"
      onclick={() => (chipOpen = !chipOpen)}
    >
      {@render line(parts)}
    </button>
    <Popover bind:open={chipOpen} trigger={chip} align="end" label="Session status">
      <div class="pop">{@render line(allParts)}</div>
    </Popover>
  {:else}
    <span class="status">{@render line(parts)}</span>
  {/if}

  <div bind:this={bell} class="slot bell" data-slot="bell">
    <span class="bell-anchor">
      <TooltipButton
        icon="notifications"
        label={bellCount > 0 ? `Notifications, ${bellCount} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={bellOpen}
        onclick={() => (bellOpen = !bellOpen)}
      />
      {#if bellCount > 0}<span class="bell-badge"
          ><Badge variant="destructive" size="sm">{bellCount}</Badge></span
        >{/if}
    </span>
    <Popover bind:open={bellOpen} trigger={bell} align="end" attached label="Notifications">
      <div class="bell-pop">
        {#if collapsed}<div class="bell-chips"><StatusChips /></div>{/if}
        <NotificationsPanel />
      </div>
    </Popover>
  </div>

  {#if tier === "compact"}
    <TooltipButton
      icon="search"
      label="Jump to"
      shortcut={$chords.jump}
      onclick={() => jumpOpen.set(true)}
    />
  {:else}
    <Button variant="ghost" size="sm" onclick={() => jumpOpen.set(true)}>
      Jump to…
      <Kbd>{$chords.jump}</Kbd>
    </Button>
  {/if}

  <Button variant="default" size="sm" onclick={() => openNewSession()}>
    + Session
    <Kbd>{$chords.newSession}</Kbd>
  </Button>

  <TooltipButton
    icon="settings"
    label="Settings"
    shortcut={$chords.settings}
    align="end"
    onclick={() => settingsOpen.set(true)}
  />
</header>

<style>
  .topbar {
    position: relative;
    z-index: var(--z-titlebar);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-3);
    height: 46px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }

  .topbar.mac {
    padding-left: 76px;
  }

  .spacer {
    flex: 1;
    min-width: 0;
  }

  .slot:empty {
    display: none;
  }

  .slot:not(.bell):not(:empty) {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  /* Full bar height, so the attached menu hangs from the bar's bottom edge. */
  .slot.bell {
    align-self: stretch;
    display: flex;
    align-items: center;
  }

  .bell-anchor {
    position: relative;
    display: inline-flex;
  }

  /* The alert badge is see-through, so it gets the bar's fill behind it and
     sits out on the corner; otherwise the bell glyph shows through the digits. */
  .bell-badge {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    border-radius: var(--radius-full);
    background: var(--card);
    transform: translate(45%, -35%);
    pointer-events: none;
  }

  .bell-pop {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .bell-chips {
    display: flex;
    gap: var(--sp-2);
    padding: var(--sp-4) var(--sp-5) 0;
  }

  .status,
  .chip {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .chip {
    height: var(--h-md);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--muted);
    cursor: pointer;
  }

  .pop {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .part {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .part.needs {
    color: var(--warning);
  }

  .part.live {
    animation: var(--pulse);
  }

  .sep {
    color: var(--muted-foreground);
  }

  .pop .sep {
    display: none;
  }
</style>
