<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Tooltip from "../../lib/components/ui/Tooltip.svelte";
  import Popover from "../../lib/components/ui/Popover.svelte";
  import { tooltip } from "../../lib/ui/tooltip";
  import type { Side } from "../../lib/ui/floating";

  const sides: Side[] = ["top", "bottom", "left", "right"];
  let open = $state(false);
  let trigger = $state<HTMLElement>();
</script>

<GallerySection title="Tooltip and popover" states={["hover", "focus", "flipped at edge"]}>
  <div class="row">
    {#each sides as side (side)}
      <Tooltip text={`Tooltip ${side}`} {side}><button>{side}</button></Tooltip>
    {/each}
    <Tooltip text="Open session" shortcut="Cmd K"><button>With shortcut</button></Tooltip>
    <button use:tooltip={{ text: "Action, no delay", delay: 0 }}>Action (use:tooltip)</button>
  </div>
  <div class="row">
    <button bind:this={trigger} onclick={() => (open = !open)}>Popover</button>
    <Popover bind:open {trigger} label="Filters">
      <label><input type="checkbox" /> Show archived</label>
    </Popover>
  </div>
  <div class="edge">
    <Tooltip text="Flips below near the top edge" side="top"><button>Top edge</button></Tooltip>
  </div>
</GallerySection>

<style>
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 16px;
  }
  .edge {
    display: flex;
    justify-content: flex-end;
  }
</style>
