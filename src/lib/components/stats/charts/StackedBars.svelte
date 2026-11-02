<script lang="ts">
  import { formatValue, type Unit } from "../../../stats-chart";
  import BarPlot, { type Series } from "./BarPlot.svelte";

  interface Props {
    series: Series[];
    /** `parts` holds one value per series, in series order. */
    buckets: { key: string; label: string; parts: number[] }[];
    unit: Unit;
    label: string;
    emptyText: string;
    onselect?: (key: string) => void;
  }

  let { series, buckets, unit, label, emptyText, onselect }: Props = $props();

  const bars = $derived(
    buckets.map((b) => {
      const value = b.parts.reduce((a, c) => a + c, 0);
      const split = b.parts.map((v, i) => `${series[i]?.name} ${formatValue(v, unit)}`).join(", ");
      return { ...b, value, text: `${b.label}: ${formatValue(value, unit)} (${split})` };
    }),
  );
</script>

<BarPlot {bars} {series} {unit} {label} {emptyText} {onselect} />
