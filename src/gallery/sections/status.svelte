<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import StatusMark from "../../lib/components/ui/StatusMark.svelte";
  import Kbd from "../../lib/components/ui/Kbd.svelte";
  import Badge from "../../lib/components/ui/Badge.svelte";
  import StatePill from "../../lib/components/ui/StatePill.svelte";
  import Chip from "../../lib/components/ui/Chip.svelte";

  const marks = ["running", "failing", "attention", "done", "idle"] as const;
  const pills = ["running", "needs", "idle", "error"] as const;
</script>

<GallerySection title="Status, badge, pill, chip, kbd" states={["light", "dark", "reduced motion"]}>
  <div class="row">
    {#each marks as m (m)}
      <span class="item"><StatusMark state={m} /> {m}</span>
    {/each}
  </div>
  <div class="row">
    {#each pills as p (p)}
      <StatePill state={p} />
    {/each}
  </div>
  <div class="row">
    <Badge count={4} />
    <Badge count={2} alert />
    <Kbd>⌘K</Kbd>
    <button class="ink" type="button">Run <Kbd onInk>⏎</Kbd></button>
  </div>
  <div class="row">
    <Chip label="All" count={12} selected onClick={() => {}} />
    <Chip label="Atlas" count={3} colour="var(--accent)" onClick={() => {}} />
  </div>
</GallerySection>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-4);
    margin-bottom: var(--sp-4);
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-sm);
  }
  .ink {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--h-md);
    padding: 0 var(--sp-4);
    border: 0;
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--ink-text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }
</style>
