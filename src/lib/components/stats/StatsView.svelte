<script lang="ts">
  import { onMount } from "svelte";
  import type { Period } from "../../../types/codeburn";
  import { checkCodeburn, codeburnStatus } from "../../stores/codeburn";
  import { refreshCosts } from "../../stores/cost";
  import { statsFilters } from "../../stores/statsFilters";
  import Button from "../ui/Button.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import Compare from "./codeburn/Compare.svelte";
  import Models from "./codeburn/Models.svelte";
  import Optimize from "./codeburn/Optimize.svelte";
  import Overview from "./codeburn/Overview.svelte";
  import Plans from "./codeburn/Plans.svelte";
  import PullRequests from "./codeburn/PullRequests.svelte";
  import Sessions from "./codeburn/Sessions.svelte";
  import Spend from "./codeburn/Spend.svelte";

  const INSTALL = "npm i -g codeburn";

  const periods: Segment<Period>[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "7 days" },
    { id: "30days", label: "30 days" },
    { id: "month", label: "This month" },
    { id: "all", label: "All time" },
  ];

  type TabId =
    | "overview"
    | "spend"
    | "models"
    | "sessions"
    | "compare"
    | "prs"
    | "plans"
    | "optimize";

  /** One entry per codeburn page; each is rendered by its own component below. */
  const tabs: Segment<TabId>[] = [
    { id: "overview", label: "Overview" },
    { id: "spend", label: "Spend" },
    { id: "models", label: "Models" },
    { id: "sessions", label: "Sessions" },
    { id: "compare", label: "Compare" },
    { id: "prs", label: "Pull requests" },
    { id: "plans", label: "Plans" },
    { id: "optimize", label: "Optimize" },
  ];

  let tab = $state<TabId>("overview");
  /** Bumped by Refresh; every tab skips the shared cache when it changes. */
  let refresh = $state(0);

  const filters = $derived($statsFilters);

  onMount(() => void checkCodeburn());
</script>

<div class="stats-view">
  {#if $codeburnStatus && !$codeburnStatus.binary}
    <EmptyState
      icon="search"
      title="Stats need codeburn"
      description="Atlas shows usage from the codeburn command-line tool, which reads ~/.claude/projects"
    >
      {#snippet action()}
        <code>{INSTALL}</code>
        <CopyButton value={INSTALL} label="Copy install command" size="sm" />
        <Button size="sm" onclick={() => void checkCodeburn()}>Check again</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="range-bar">
      <SegmentedControl
        role="radiogroup"
        label="Period"
        options={periods}
        value={typeof filters.period === "string" ? filters.period : "30days"}
        onChange={(id) => statsFilters.update((f) => ({ ...f, period: id }))}
        size="sm"
      />
      <div class="spacer"></div>
      {#if $codeburnStatus?.version}
        <span class="live">codeburn {$codeburnStatus.version}</span>
      {/if}
      <Button size="sm" onclick={() => {
          refresh++;
          void refreshCosts(true);
        }}>Refresh</Button>
    </div>

    <div class="tab-bar">
      <SegmentedControl
        role="radiogroup"
        label="Page"
        options={tabs}
        value={tab}
        onChange={(id) => (tab = id)}
        size="sm"
      />
    </div>

    {#if tab === "overview"}
      <Overview {filters} {refresh} />
    {:else if tab === "spend"}
      <Spend {filters} {refresh} />
    {:else if tab === "models"}
      <Models {filters} {refresh} />
    {:else if tab === "sessions"}
      <Sessions {filters} {refresh} />
    {:else if tab === "compare"}
      <Compare {filters} {refresh} />
    {:else if tab === "prs"}
      <PullRequests {filters} {refresh} />
    {:else if tab === "plans"}
      <Plans {filters} {refresh} />
    {:else if tab === "optimize"}
      <Optimize {filters} {refresh} />
    {/if}
  {/if}
</div>

<style>
  .stats-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: var(--sp-3);
    min-height: 0;
    padding: var(--sp-3) var(--sp-5) var(--sp-4);
    overflow: auto;
    font-family: var(--font-ui);
    color: var(--text);
  }

  .tab-bar {
    flex-shrink: 0;
    overflow-x: auto;
  }

  .range-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-3);
  }

  .spacer {
    flex: 1;
  }

  .live {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
</style>
