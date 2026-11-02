<script lang="ts">
  import SegmentedControl, { type Segment } from "../../lib/components/ui/SegmentedControl.svelte";
  import GallerySection from "../GallerySection.svelte";

  const base: Segment[] = [
    { id: "a", label: "Overview" },
    { id: "b", label: "Files" },
    { id: "c", label: "Changes" },
  ];
  const counts: Segment[] = [
    { id: "a", label: "Open", count: 4 },
    { id: "b", label: "Review", count: 2, alert: true },
    { id: "c", label: "Files", dot: true },
  ];
  const disabled: Segment[] = [
    { id: "a", label: "Edit" },
    { id: "b", label: "Preview", disabled: true },
  ];
  let value = $state("a");
  const set = (v: string) => (value = v);
</script>

<GallerySection
  title="Segmented control"
  states={["md", "sm", "fill", "disabled", "count", "alert", "dot", "radiogroup"]}
>
  <div class="col">
    <SegmentedControl options={base} {value} onChange={set} label="Views" />
    <SegmentedControl options={base} {value} onChange={set} size="sm" label="Views small" />
    <SegmentedControl options={base} {value} onChange={set} fill label="Fill" />
    <SegmentedControl options={counts} {value} onChange={set} label="Counts" />
    <SegmentedControl options={disabled} {value} onChange={set} label="Disabled" />
    <SegmentedControl options={base} {value} onChange={set} role="radiogroup" label="Radio" />
  </div>
</GallerySection>

<style>
  .col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
</style>
