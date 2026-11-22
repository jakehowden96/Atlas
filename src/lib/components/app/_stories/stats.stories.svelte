<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import StatsView from "../stats/StatsView.svelte";
  import Sparkline from "../stats/Sparkline.svelte";
  import ActivityGrid from "../stats/charts/ActivityGrid.svelte";
  import BarChart from "../stats/charts/BarChart.svelte";
  import BarPlot from "../stats/charts/BarPlot.svelte";
  import ChartCard from "../stats/charts/ChartCard.svelte";
  import DailySpend from "../stats/charts/DailySpend.svelte";
  import HBarList from "../stats/charts/HBarList.svelte";
  import RankList from "../stats/charts/RankList.svelte";
  import Ring from "../stats/charts/Ring.svelte";
  import Sankey from "../stats/charts/Sankey.svelte";
  import ChartSparkline from "../stats/charts/Sparkline.svelte";
  import SpendChart from "../stats/charts/SpendChart.svelte";
  import StackedBars from "../stats/charts/StackedBars.svelte";
  import Card from "../stats/codeburn/Card.svelte";
  import Compare from "../stats/codeburn/Compare.svelte";
  import ComparePeriods from "../stats/codeburn/ComparePeriods.svelte";
  import Loader from "../stats/codeburn/Loader.svelte";
  import Models from "../stats/codeburn/Models.svelte";
  import Optimize from "../stats/codeburn/Optimize.svelte";
  import Overview from "../stats/codeburn/Overview.svelte";
  import Plans from "../stats/codeburn/Plans.svelte";
  import Plugins from "../stats/codeburn/Plugins.svelte";
  import PullRequests from "../stats/codeburn/PullRequests.svelte";
  import Sessions from "../stats/codeburn/Sessions.svelte";
  import Settings from "../stats/codeburn/Settings.svelte";
  import Spend from "../stats/codeburn/Spend.svelte";
  import spend from "../stats/codeburn/__fixtures__/spend.json";
  import type { Filters } from "../../../../types/codeburn";
  import type { SpendFlow } from "../../../../types/codeburn-spend";
  import type { Point } from "$lib/stats-chart";
  import { seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Stats",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const filters: Filters = { period: "30days" };
  const noop = () => {};
  const day = (i: number) => new Date(Date.now() - (13 - i) * 86_400_000);
  const label = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const costs = [2.1, 3.4, 1.2, 4.8, 3.9, 0, 0.6, 5.2, 4.1, 3.3, 2.8, 4.4, 3.1, 2.81];
  const daily: Point[] = costs.map((v, i) => ({ key: `d${i}`, label: label(day(i)), value: v }));
  const models: Point[] = [
    { key: "sonnet", label: "Sonnet 4.5", value: 88.1 },
    { key: "opus", label: "Opus 4.1", value: 49.9, context: "35% of spend" },
    { key: "haiku", label: "Haiku 4.5", value: 4.5 },
  ];
  const series = [
    { name: "Opus", model: "opus" as const },
    { name: "Sonnet", model: "sonnet" as const },
    { name: "Haiku", model: "haiku" as const },
  ];
  const buckets = costs.map((v, i) => ({
    key: `d${i}`,
    label: label(day(i)),
    parts: [v * 0.4, v * 0.5, v * 0.1],
  }));
  const trend = buckets.map((b, i) => ({
    key: b.key,
    label: b.label,
    total: costs[i]!,
    parts: { opus: b.parts[0]!, sonnet: b.parts[1]!, haiku: b.parts[2]! },
  }));
  const trendSeries = [
    { id: "opus", label: "Opus", color: "var(--chart-1)" },
    { id: "sonnet", label: "Sonnet", color: "var(--chart-2)" },
    { id: "haiku", label: "Haiku", color: "var(--chart-3)" },
  ];
  const bars = buckets.map((b, i) => ({
    key: b.key,
    label: b.label,
    text: `${b.label}: $${costs[i]}`,
    parts: b.parts,
    value: costs[i]!,
  }));
  // ActivityGrid places cells by their ISO date key.
  const cells: Point[] = Array.from({ length: 182 }, (_, i) => ({
    key: new Date(Date.now() - (181 - i) * 86_400_000).toISOString().slice(0, 10),
    label: `day ${i}`,
    value: i > 150 ? Math.round(Math.abs(Math.sin(i)) * 20) : i % 3 ? 0 : 4,
  }));
  const failing = {
    ...worldBackend,
    codeburn_run: () => {
      throw { kind: "unknown", message: "codeburn exited with status 2" };
    },
  };
  const wide = "max-width: 720px";
</script>

<Story name="Screen" parameters={{ layout: "fullscreen" }} beforeEach={() => seedWorld("stats")}>
  {#snippet template()}<div style="height: 100vh; display: flex; flex-direction: column"><StatsView /></div>{/snippet}
</Story>

<Story name="Overview">{#snippet template()}<Overview {filters} refresh={0} onNavigate={noop} onOpenSession={noop} />{/snippet}</Story>
<Story name="Sessions tab">{#snippet template()}<Sessions {filters} refresh={0} />{/snippet}</Story>
<Story name="Pull requests tab">{#snippet template()}<PullRequests {filters} refresh={0} />{/snippet}</Story>
<Story name="Spend tab">{#snippet template()}<Spend {filters} refresh={0} />{/snippet}</Story>
<Story name="Models tab">{#snippet template()}<Models {filters} refresh={0} onCompare={noop} />{/snippet}</Story>
<Story name="Optimize tab">{#snippet template()}<Optimize {filters} refresh={0} />{/snippet}</Story>
<Story name="Compare tab">{#snippet template()}<Compare {filters} refresh={0} />{/snippet}</Story>
<Story name="Compare periods tab">{#snippet template()}<ComparePeriods {filters} refresh={0} />{/snippet}</Story>
<Story name="Plans tab">{#snippet template()}<Plans {filters} refresh={0} />{/snippet}</Story>
<Story name="Plugins tab">{#snippet template()}<Plugins refresh={0} />{/snippet}</Story>
<Story name="Settings tab">{#snippet template()}<Settings refresh={0} />{/snippet}</Story>

<Story name="Loader, error" parameters={{ backend: failing }}>
  {#snippet template()}
    <div style="max-width: 420px">
      <Loader args={["status", "--format", "json", "--story-error"]}>
        {#snippet children()}<p>never</p>{/snippet}
      </Loader>
    </div>
  {/snippet}
</Story>

<Story name="Card">
  {#snippet template()}<div style={wide}><Card title="Month to date" note="as of 19:29"><p>$137.29</p></Card></div>{/snippet}
</Story>

<Story name="Chart card">
  {#snippet template()}
    <div style={wide}>
      <ChartCard id="daily" title="Daily spend" summary="$45.71 over 14 days" rows={daily} unit="usd">
        <BarChart points={daily} unit="usd" label="Daily spend" emptyText="No spend yet" />
      </ChartCard>
    </div>
  {/snippet}
</Story>

<Story name="Bar chart">
  {#snippet template()}<div style={wide}><BarChart points={daily} unit="usd" label="Daily spend" emptyText="No spend yet" /></div>{/snippet}
</Story>
<Story name="Bar chart, empty">
  {#snippet template()}<div style={wide}><BarChart points={[]} unit="usd" label="Daily spend" emptyText="No spend yet" /></div>{/snippet}
</Story>
<Story name="Bar plot, stacked">
  {#snippet template()}<div style={wide}><BarPlot {bars} {series} unit="usd" label="Spend by model" emptyText="No spend yet" /></div>{/snippet}
</Story>
<Story name="Stacked bars">
  {#snippet template()}<div style={wide}><StackedBars {series} {buckets} unit="usd" label="Spend by model" emptyText="No spend yet" /></div>{/snippet}
</Story>
<Story name="Daily spend">
  {#snippet template()}<div style={wide}><DailySpend days={trend} series={trendSeries} label="Daily spend" /></div>{/snippet}
</Story>
<Story name="Spend chart">
  {#snippet template()}<div style={wide}><SpendChart days={daily.map((d) => ({ label: d.label, total: d.value }))} /></div>{/snippet}
</Story>
<Story name="Horizontal bars">
  {#snippet template()}<div style="max-width: 360px"><HBarList points={models} unit="usd" label="Spend by model" emptyText="No models" /></div>{/snippet}
</Story>
<Story name="Rank list">
  {#snippet template()}
    <div style="max-width: 360px">
      <RankList
        label="Most expensive sessions"
        active="b"
        items={[
          { key: "a", title: "retry-after-header", sub: "billing · Opus", value: "$4.18" },
          { key: "b", title: "pinned-tiles", sub: "atlas · Sonnet", value: "$1.37" },
          { key: "c", title: "overview-sort", sub: "atlas · Sonnet", value: "$0.960" },
        ]}
      />
    </div>
  {/snippet}
</Story>
<Story name="Ring">
  {#snippet template()}
    <div style="display: flex; gap: 24px"><Ring value={80} grade="B" label="Efficiency" hint="/100" /><Ring value={94} label="Quota" /></div>
  {/snippet}
</Story>
<Story name="Activity grid">
  {#snippet template()}<div style={wide}><ActivityGrid {cells} noun="sessions" /></div>{/snippet}
</Story>
<Story name="Sankey">
  {#snippet template()}<div style={wide}><Sankey flow={spend as SpendFlow} /></div>{/snippet}
</Story>
<Story name="Sparklines">
  {#snippet template()}
    <div style="display: grid; gap: 16px; width: 240px">
      <ChartSparkline values={costs} label="Cumulative spend" labels={daily.map((d) => d.label)} format={(v) => `$${v.toFixed(2)}`} />
      <ChartSparkline values={costs} dashed label="Projected" />
      <Sparkline values={costs} />
    </div>
  {/snippet}
</Story>
