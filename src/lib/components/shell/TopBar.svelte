<script lang="ts">
  import { onDestroy } from "svelte";
  import AtlasMark from "../ui/AtlasMark.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Kbd from "../ui/Kbd.svelte";
  import Popover from "../ui/Popover.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import StatusMark from "../ui/StatusMark.svelte";
  import Tooltip from "../ui/Tooltip.svelte";
  import Badge from "../ui/Badge.svelte";
  import NotificationsPanel, { unreadNotificationCount } from "../ui/NotificationsPanel.svelte";
  import StatusChips, { statusChipCount } from "./StatusChips.svelte";
  import { isMacPlatform } from "../../platform";
  import { todayCost } from "../../stats-derive";
  import { dirtyFiles } from "../../stores/files";
  import { liveTiles } from "../../stores/liveTiles";
  import { prsAttentionCount } from "../../stores/prs";
  import { chords, settingsOpen } from "../../stores/settings";
  import { statsSummary } from "../../stores/stats";
  import { activeView, jumpOpen, openNewSession, showView, type View } from "../../stores/view";
  import { statusParts, topBarTier, type StatusPart } from "../../topbar";

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
  /* Today's spend comes off the persisted stats, not off `liveSessionList`:
     that list holds only the sessions Atlas is tailing, so a day's work done
     in Claude Code outside Atlas read as $0. The midnight rollover needs a clock. */
  let costClock = $state(Date.now());
  const costTicker = setInterval(() => {
    costClock = Date.now();
  }, 60_000);
  onDestroy(() => clearInterval(costTicker));
  let spend = $derived(todayCost($statsSummary, new Date(costClock)));

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

  function markState(p: StatusPart) {
    if (p.kind === "running") return "running";
    if (p.kind === "needsYou") return "attention";
    return "idle";
  }
</script>

{#snippet line(list: StatusPart[], marks: boolean)}
  {#each list as p, i (p.kind)}
    {#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}
    <span class="part" class:needs={p.kind === "needsYou"}>
      {#if marks && p.kind !== "spend"}
        <!-- The live mark pulses only while something runs. -->
        {#if p.kind === "running" && running === 0}
          <StatusMark state="idle" />
        {:else if p.kind === "needsYou" && needsYou === 0}
          <StatusMark state="idle" />
        {:else}
          <StatusMark state={markState(p)} />
        {/if}
      {/if}
      {p.text}
    </span>
  {/each}
{/snippet}

<header class="topbar" class:mac data-tauri-drag-region bind:clientWidth={width}>
  <span class="brand">
    <AtlasMark size={20} />
    <span class="wordmark">Atlas</span>
  </span>
  <!-- Session is a detail view Sessions opens in place, not a tab of its own,
       so Sessions stays lit while it is showing. -->
  <SegmentedControl
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
      {@render line(parts, true)}
    </button>
    <Popover bind:open={chipOpen} trigger={chip} align="end" label="Session status">
      <div class="pop">{@render line(allParts, true)}</div>
    </Popover>
  {:else}
    <span class="status">{@render line(parts, true)}</span>
  {/if}

  <div class="slot bell" data-slot="bell">
    <span bind:this={bell} class="bell-anchor">
      <IconButton
        icon="notifications"
        label={bellCount > 0 ? `Notifications, ${bellCount} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={bellOpen}
        onclick={() => (bellOpen = !bellOpen)}
      />
      {#if bellCount > 0}<span class="bell-badge"><Badge count={bellCount} alert /></span>{/if}
    </span>
    <Popover bind:open={bellOpen} trigger={bell} align="end" label="Notifications">
      <div class="bell-pop">
        {#if collapsed}<StatusChips />{/if}
        <NotificationsPanel />
      </div>
    </Popover>
  </div>

  {#if tier === "compact"}
    <Tooltip text="Jump to" shortcut={$chords.jump}>
      <IconButton icon="search" label="Jump to" onclick={() => jumpOpen.set(true)} />
    </Tooltip>
  {:else}
    <Button variant="ghost" size="sm" onclick={() => jumpOpen.set(true)}>
      Jump to…
      {#snippet trailing()}<Kbd>{$chords.jump}</Kbd>{/snippet}
    </Button>
  {/if}

  <Button variant="primary" size="sm" onclick={() => openNewSession()}>
    + Session
    {#snippet trailing()}<Kbd onInk>{$chords.newSession}</Kbd>{/snippet}
  </Button>

  <Tooltip text="Settings" shortcut={$chords.settings} align="end">
    <IconButton icon="settings" label="Settings" onclick={() => settingsOpen.set(true)} />
  </Tooltip>
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
    background: var(--surface);
  }

  .topbar.mac {
    padding-left: 76px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    margin-right: var(--sp-3);
  }

  .wordmark {
    font-size: var(--fs-sm);
    font-weight: 600;
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

  .bell-anchor {
    position: relative;
    display: inline-flex;
  }

  .bell-badge {
    position: absolute;
    top: calc(var(--sp-1) * -1);
    right: calc(var(--sp-1) * -1);
    pointer-events: none;
  }

  .bell-pop {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-2);
  }

  .status,
  .chip {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  .chip {
    height: var(--h-md);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface2);
    cursor: pointer;
  }

  .pop {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }

  .part {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .part.needs {
    color: var(--warn);
  }

  .sep {
    color: var(--muted);
  }

  .pop .sep {
    display: none;
  }
</style>
