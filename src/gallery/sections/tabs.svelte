<script lang="ts">
  import Tabs, { type Tab } from "../../lib/components/ui/Tabs.svelte";
  import GallerySection from "../GallerySection.svelte";

  const few: Tab[] = [
    { id: "a", label: "main.ts" },
    { id: "b", label: "App.svelte", dirty: true },
    { id: "c", label: "README.md" },
  ];
  const many: Tab[] = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`,
    label: `file-${i}.ts`,
    dirty: i % 7 === 0,
  }));
  const nav: Tab[] = [
    { id: "g", label: "General", group: "App" },
    { id: "n", label: "Notifications", group: "App" },
    { id: "k", label: "Keys", group: "Advanced" },
    { id: "c", label: "Connectors", group: "Advanced" },
  ];
  let fewV = $state("a");
  let manyV = $state("f12");
  let navV = $state("g");
</script>

<GallerySection title="Tabs" states={["3 tabs", "30 tabs", "vertical grouped", "unsaved"]}>
  <div class="col">
    <Tabs tabs={few} value={fewV} onselect={(id) => (fewV = id)} onclose={() => {}} label="Few files" />
    <Tabs tabs={many} value={manyV} onselect={(id) => (manyV = id)} onclose={() => {}} label="Many files" />
    <div class="side">
      <Tabs tabs={nav} value={navV} onselect={(id) => (navV = id)} vertical label="Settings" />
    </div>
  </div>
</GallerySection>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
  }
  .side {
    width: 200px;
  }
</style>
