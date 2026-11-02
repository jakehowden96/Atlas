<script lang="ts">
  import BarChart from "../../lib/components/stats/charts/BarChart.svelte";
  import ChartCard from "../../lib/components/stats/charts/ChartCard.svelte";
  import Heatmap from "../../lib/components/stats/charts/Heatmap.svelte";
  import HBarList from "../../lib/components/stats/charts/HBarList.svelte";
  import Kpi from "../../lib/components/stats/charts/Kpi.svelte";
  import StackedBars from "../../lib/components/stats/charts/StackedBars.svelte";
  import type { Point } from "../../lib/stats-chart";
  import GallerySection from "../GallerySection.svelte";

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const spend: Point[] = [3.2, 18.4, 7.9, 5.1, 9.6, 1.2, 0].map((value, i) => ({
    key: days[i] ?? "",
    label: days[i] ?? "",
    value,
  }));
  const models = [
    { name: "Opus", model: "opus" as const },
    { name: "Sonnet", model: "sonnet" as const },
    { name: "Haiku", model: "haiku" as const },
  ];
  const buckets = days.map((d, i) => ({ key: d, label: d, parts: [i + 1, (i * 2) % 5, 1] }));
  const tools: Point[] = [
    { key: "read", label: "Read", value: 220 },
    { key: "edit", label: "Edit", value: 130 },
    { key: "bash", label: "Bash", value: 90 },
  ];
  const cells: Point[] = Array.from({ length: 28 }, (_, i) => ({
    key: `d${i}`,
    label: `${days[i % 7]} ${i + 1} Oct`,
    value: (i * 7) % 9,
  }));
  const none = "No sessions between 1 and 7 Oct";
</script>

<GallerySection title="Stats charts" states={["data", "empty range", "loading", "table"]}>
  <div class="col">
    <div class="kpis">
      <Kpi label="Spend" value="$45.40" delta={12} spark={[1, 3, 2, 5, 4]} />
      <Kpi label="Sessions" value="31" delta={-40} />
    </div>
    <ChartCard id="g-spend" title="Spend by day" summary="Spend peaked Tuesday at $18.40" rows={spend} unit="usd">
      <BarChart points={spend} unit="usd" label="Spend by day" emptyText={none} />
    </ChartCard>
    <ChartCard id="g-empty" title="Spend by day, empty" summary="No spend in this range" rows={[]} unit="usd">
      <BarChart points={[]} unit="usd" label="Spend by day" emptyText={none} />
    </ChartCard>
    <ChartCard id="g-load" title="Spend by day, loading" summary="Loading" rows={[]} unit="usd" loading>
      <BarChart points={[]} unit="usd" label="Spend by day" emptyText={none} />
    </ChartCard>
    <ChartCard id="g-models" title="Spend by model" summary="Opus led every day" rows={spend} unit="count">
      <StackedBars series={models} {buckets} unit="count" label="Spend by model" emptyText={none} />
    </ChartCard>
    <ChartCard id="g-tools" title="Tool calls" summary="Read was called most" rows={tools} unit="count">
      <HBarList points={tools} unit="count" label="Tool calls" emptyText="No tool calls" />
    </ChartCard>
    <ChartCard id="g-heat" title="Sessions by day" summary="Busiest on Tuesdays" rows={cells} unit="count">
      <Heatmap {cells} noun="session" label="Sessions by day" emptyText="No sessions" />
    </ChartCard>
  </div>
</GallerySection>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }
  .kpis {
    display: flex;
    gap: var(--sp-8);
  }
</style>
