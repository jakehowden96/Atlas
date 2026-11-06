<script lang="ts">
  import { onMount } from "svelte";
  import type { Overview as OverviewData, Period } from "../../../types/codeburn";
  import { checkCodeburn, codeburn, codeburnStatus } from "../../stores/codeburn";
  import { refreshCosts } from "../../stores/cost";
  import { statsFilters } from "../../stores/statsFilters";
  import { localDayKey } from "../../stats-derive";
  import { tooltip } from "../../ui/tooltip";
  import Button from "../ui/Button.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import Select, { type SelectOption } from "../ui/Select.svelte";
  import Tabs, { type Tab } from "../ui/Tabs.svelte";
  import Compare from "./codeburn/Compare.svelte";
  import ComparePeriods from "./codeburn/ComparePeriods.svelte";
  import Models from "./codeburn/Models.svelte";
  import Optimize from "./codeburn/Optimize.svelte";
  import Overview from "./codeburn/Overview.svelte";
  import Plans from "./codeburn/Plans.svelte";
  import Plugins from "./codeburn/Plugins.svelte";
  import PullRequests from "./codeburn/PullRequests.svelte";
  import Sessions from "./codeburn/Sessions.svelte";
  import Settings from "./codeburn/Settings.svelte";
  import Spend from "./codeburn/Spend.svelte";

  const INSTALL = "npm i -g codeburn";

  type Range = Period | "since";
  const ranges: Segment<Range>[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "7d" },
    { id: "30days", label: "30d" },
    { id: "month", label: "Month" },
    { id: "all", label: "All" },
    { id: "since", label: "Since" },
  ];

  /** One entry per codeburn page; each is rendered by its own component below. */
  const tabs: Tab[] = [
    { id: "overview", label: "Overview" },
    { id: "sessions", label: "Sessions" },
    { id: "pull-requests", label: "Pull requests" },
    { id: "spend", label: "Spend" },
    { id: "models", label: "Models" },
    { id: "optimize", label: "Optimize" },
    { id: "compare", label: "Compare" },
    { id: "compare-periods", label: "Compare periods" },
    { id: "plans", label: "Plans" },
    { id: "plugins", label: "Plugins" },
  ];

  interface Quota {
    providers: { id: string; name: string; available: boolean; windows: { usedPct: number }[] }[];
  }

  let tab = $state("overview");
  let settings = $state(false);
  /** Bumped by Refresh; every tab skips the shared cache when it changes. */
  let refresh = $state(0);
  let refreshedAt = $state(Date.now());
  let now = $state(Date.now());
  let since = $state("");
  let projects = $state<SelectOption[]>([]);
  let providers = $state<SelectOption[]>([]);
  let quotaPct = $state<number | null>(null);

  const filters = $derived($statsFilters);
  const range = $derived<Range>(typeof filters.period === "string" ? filters.period : "since");
  const ago = $derived(Math.max(0, Math.round((now - refreshedAt) / 1000)));
  const quotaTone = $derived(
    quotaPct === null ? "" : quotaPct >= 90 ? "bad" : quotaPct >= 75 ? "warn" : "ok",
  );

  function setSince(v: string) {
    since = v;
    if (v) statsFilters.update((f) => ({ ...f, period: { from: v, to: localDayKey(new Date()) } }));
  }
  function setRange(id: Range) {
    if (id === "since") return setSince(since || localDayKey(new Date()));
    statsFilters.update((f) => ({ ...f, period: id }));
  }
  const setFilter = (key: "project" | "provider") => (id: string) =>
    statsFilters.update((f) => ({ ...f, [key]: id === "all" ? undefined : id }));

  function doRefresh() {
    refresh++;
    refreshedAt = Date.now();
    void refreshCosts(true);
    void loadMeta(true);
  }

  /** Project and provider choices and the quota chip: all from codeburn. */
  async function loadMeta(fresh = false) {
    const [ov, quota] = await Promise.all([
      codeburn<OverviewData>(
        ["status", "--format", "menubar-json", "--period", "all", "--no-optimize"],
        fresh,
      ).catch(() => null),
      codeburn<Quota>(["quota", "--format", "json"], fresh).catch(() => null),
    ]);
    projects = [
      { id: "all", label: "All projects" },
      ...(ov?.current.topProjects ?? []).map((p) => ({ id: p.id, label: p.name })),
    ];
    const ps = (quota?.providers ?? []).filter((p) => p.available);
    providers = [
      { id: "all", label: "All providers" },
      ...ps.map((p) => ({ id: p.id, label: p.name })),
    ];
    const pcts = ps.flatMap((p) => p.windows.map((w) => w.usedPct));
    quotaPct = pcts.length ? Math.max(...pcts) : null;
  }

  onMount(() => {
    void checkCodeburn();
    void loadMeta();
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });
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
        label="Range"
        options={ranges}
        value={range}
        onChange={setRange}
        size="sm"
      />
      {#if range === "since"}
        <input
          class="since"
          type="date"
          aria-label="Since date"
          value={since}
          onchange={(e) => setSince(e.currentTarget.value)}
        />
      {/if}
      <Select
        size="sm"
        aria-label="Project"
        options={projects}
        value={filters.project ?? "all"}
        onChange={setFilter("project")}
      />
      <Select
        size="sm"
        aria-label="Provider"
        options={providers}
        value={filters.provider ?? "all"}
        onChange={setFilter("provider")}
      />
      <div class="spacer"></div>
      {#if quotaPct !== null}
        <span class="quota {quotaTone}" use:tooltip={{ text: "Highest quota window in use" }}>
          Quota {Math.round(quotaPct)}%
        </span>
      {/if}
      <button type="button" class="live" onclick={doRefresh}>refreshed {ago}s ago ↻</button>
      <IconButton
        icon="settings"
        label="Settings"
        size="sm"
        onclick={() => (settings = !settings)}
      />
    </div>

    <div class="tab-bar">
      <Tabs
        {tabs}
        value={settings ? "" : tab}
        label="Page"
        onselect={(id) => {
          settings = false;
          tab = id;
        }}
      />
    </div>

    {#if settings}
      <Settings {refresh} />
    {:else if tab === "overview"}
      <Overview {filters} {refresh} onOpenSession={(id) => { sessionTarget.set(id); tab = "sessions"; }} />
    {:else if tab === "spend"}
      <Spend {filters} {refresh} />
    {:else if tab === "models"}
      <Models {filters} {refresh} />
    {:else if tab === "sessions"}
      <Sessions {filters} {refresh} />
    {:else if tab === "compare"}
      <Compare {filters} {refresh} />
    {:else if tab === "compare-periods"}
      <ComparePeriods {filters} {refresh} />
    {:else if tab === "pull-requests"}
      <PullRequests {filters} {refresh} />
    {:else if tab === "plans"}
      <Plans {filters} {refresh} />
    {:else if tab === "plugins"}
      <Plugins {refresh} />
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

  .since {
    height: var(--h-sm);
    padding: 0 var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
  }

  .quota {
    padding: 2px var(--sp-2);
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .quota.warn {
    border-color: var(--warn, orange);
    color: var(--warn, orange);
  }
  .quota.bad {
    border-color: var(--danger, red);
    color: var(--danger, red);
  }

  .live {
    border: 0;
    background: none;
    cursor: pointer;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
</style>
