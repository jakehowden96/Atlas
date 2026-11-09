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
  import "./codeburn/table.css";
  import Compare from "./codeburn/Compare.svelte";
  import ComparePeriods from "./codeburn/ComparePeriods.svelte";
  import Models from "./codeburn/Models.svelte";
  import Optimize from "./codeburn/Optimize.svelte";
  import { sessionTarget } from "../../stores/sessionTarget";
import Overview from "./codeburn/Overview.svelte";
  import Plans from "./codeburn/Plans.svelte";
  import Plugins from "./codeburn/Plugins.svelte";
  import PullRequests from "./codeburn/PullRequests.svelte";
  import Sessions from "./codeburn/Sessions.svelte";
  import Settings from "./codeburn/Settings.svelte";
  import Spend from "./codeburn/Spend.svelte";

  const INSTALL = "npm i -g codeburn";

  type Range = Period | "6m" | "since";
  const ranges: Segment<Range>[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "7D" },
    { id: "30days", label: "30D" },
    { id: "month", label: "Month" },
    { id: "6m", label: "6M" },
    { id: "all", label: "Life" },
  ];
  const rangeName: Record<string, string> = {
    today: "Today",
    week: "Last 7 days",
    "30days": "Last 30 days",
    month: "This month",
    "6m": "Last 6 months",
    all: "Lifetime",
  };

  /** One entry per codeburn page; each is rendered by its own component below. */
  const tabs: Tab[] = [
    { id: "overview", label: "Overview" },
    { id: "sessions", label: "Sessions", divider: true },
    { id: "pull-requests", label: "Pull requests" },
    { id: "spend", label: "Spend" },
    { id: "models", label: "Models" },
    { id: "optimize", label: "Optimize", divider: true },
    { id: "compare", label: "Compare" },
    { id: "compare-periods", label: "Compare periods" },
    { id: "plans", label: "Plans", divider: true },
    { id: "plugins", label: "Plugins" },
  ];

  function sixMonthsAgo(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return localDayKey(d);
  }

  interface Quota {
    providers: { id: string; name: string; available: boolean; windows: { usedPct: number }[] }[];
  }

  let tab = $state("overview");
  let settings = $state(false);
  let cmpModel = $state("");
  /** Bumped by Refresh; every tab skips the shared cache when it changes. */
  let refresh = $state(0);
  let refreshedAt = $state(Date.now());
  let now = $state(Date.now());
  let since = $state("");
  let projects = $state<SelectOption[]>([]);
  let providers = $state<SelectOption[]>([]);
  let quotaPct = $state<number | null>(null);

  const filters = $derived($statsFilters);
  const range = $derived<Range>(
    typeof filters.period === "string"
      ? filters.period
      : filters.period.from === sixMonthsAgo() && filters.period.to === localDayKey(new Date())
        ? "6m"
        : "since",
  );
  const context = $derived(
    [
      typeof filters.period === "string" || range === "6m"
        ? rangeName[range]
        : `Since ${filters.period.from}`,
      filters.project ? (projects.find((p) => p.id === filters.project)?.label ?? filters.project) : null,
      filters.provider
        ? (providers.find((p) => p.id === filters.provider)?.label ?? filters.provider)
        : "All providers",
    ]
      .filter(Boolean)
      .join(" · "),
  );
  let sincePicker = $state<HTMLInputElement>();
  const ago = $derived(Math.max(0, Math.round((now - refreshedAt) / 1000)));
  const quotaTone = $derived(
    quotaPct === null ? "" : quotaPct >= 90 ? "bad" : quotaPct >= 75 ? "warn" : "ok",
  );

  function setSince(v: string) {
    since = v;
    if (v) statsFilters.update((f) => ({ ...f, period: { from: v, to: localDayKey(new Date()) } }));
  }
  function setRange(id: Range) {
    if (id === "6m") {
      return statsFilters.update((f) => ({
        ...f,
        period: { from: sixMonthsAgo(), to: localDayKey(new Date()) },
      }));
    }
    if (id === "since") return;
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
<div class="column">
    <div class="range-bar">
      <div class="heading">
        <h2>Stats</h2>
        <span class="ctx">{context}</span>
      </div>
      <div class="spacer"></div>
      <Select
        size="sm"
        aria-label="Project"
        options={projects}
        value={filters.project ?? "all"}
        onChange={setFilter("project")}
      />
      <SegmentedControl
        role="radiogroup"
        label="Range"
        options={ranges}
        value={range}
        onChange={setRange}
        size="sm"
      />
      <button
        type="button"
        class="cal"
        class:on={range === "since"}
        aria-label="Since date"
        use:tooltip={{ text: "Since a date" }}
        onclick={() => sincePicker?.showPicker()}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>
      <input
        bind:this={sincePicker}
        class="since"
        type="date"
        tabindex="-1"
        aria-hidden="true"
        value={since}
        onchange={(e) => setSince(e.currentTarget.value)}
      />
      <Select
        size="sm"
        aria-label="Provider"
        options={providers}
        value={filters.provider ?? "all"}
        onChange={setFilter("provider")}
      />
      {#if quotaPct !== null}
        <span
          class="ring {quotaTone}"
          style:--pct={Math.min(100, quotaPct)}
          role="img"
          aria-label="Quota {Math.round(quotaPct)}%"
          use:tooltip={{ text: `Highest quota window in use: ${Math.round(quotaPct)}%` }}
        ></span>
      {/if}
      <button type="button" class="live" onclick={doRefresh}>refreshed {ago}s ago</button>
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
      <Overview {filters} {refresh} onNavigate={(id) => (tab = id)} onOpenSession={(id) => { sessionTarget.set(id); tab = "sessions"; }} />
    {:else if tab === "spend"}
      <Spend {filters} {refresh} />
    {:else if tab === "models"}
      <Models {filters} {refresh} onCompare={(m) => { cmpModel = m; tab = "compare"; }} />
    {:else if tab === "sessions"}
      <Sessions {filters} {refresh} />
    {:else if tab === "compare"}
      <Compare {filters} {refresh} preselect={cmpModel} />
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
</div>
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

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    width: 100%;
    max-width: 1020px;
    margin: 0 auto;
  }

  .tab-bar {
    flex-shrink: 0;
  }

  .range-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-3);
  }

  .heading {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: var(--fw-semi);
  }
  .ctx {
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  .spacer {
    flex: 1;
  }

  /* Hidden: the calendar button opens its native picker. */
  .since {
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }
  .cal {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--h-sm);
    height: var(--h-sm);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }
  .cal.on,
  .cal:hover {
    color: var(--text);
  }

  .ring {
    --c: var(--accent);
    width: var(--h-xs);
    height: var(--h-xs);
    border-radius: 50%;
    background: conic-gradient(var(--c) calc(var(--pct) * 1%), var(--border) 0);
    mask: radial-gradient(circle, transparent 5px, black 6px);
  }
  .ring.warn {
    --c: var(--warn);
  }
  .ring.bad {
    --c: var(--danger);
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
