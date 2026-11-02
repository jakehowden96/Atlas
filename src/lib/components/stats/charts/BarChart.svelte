<script lang="ts">
  import { medianText, pointText, type Point, type Unit } from "../../../stats-chart";
  import BarPlot from "./BarPlot.svelte";

  interface Props {
    points: Point[];
    unit: Unit;
    label: string;
    emptyText: string;
    onselect?: (key: string) => void;
  }

  let { points, unit, label, emptyText, onselect }: Props = $props();

  const values = $derived(points.map((p) => p.value));
  const bars = $derived(
    points.map((p) => ({
      key: p.key,
      label: p.label,
      value: p.value,
      text: pointText({ ...p, context: p.context ?? medianText(p.value, values) }, unit),
    })),
  );
</script>

<BarPlot {bars} {unit} {label} {emptyText} {onselect} />
