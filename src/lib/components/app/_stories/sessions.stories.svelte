<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import SessionsView from "../sessions/SessionsView.svelte";
  import SessionTile from "../sessions/SessionTile.svelte";
  import { SEEDS, seedWorld, tileOf, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Sessions",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const now = Date.now();
  const sessions = () => seedWorld("sessions");
</script>

<Story name="Grid" parameters={{ layout: "fullscreen" }} beforeEach={sessions}>
  {#snippet template()}<div style="height: 100vh; display: flex; flex-direction: column"><SessionsView /></div>{/snippet}
</Story>

<Story name="Grid, empty" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<div style="height: 100vh; display: flex; flex-direction: column"><SessionsView /></div>{/snippet}
</Story>

<!-- One tile per seeded state, at the grid's two-per-row width. -->
<Story name="Tiles" beforeEach={sessions}>
  {#snippet template()}
    <div style="display: grid; grid-template-columns: repeat(2, 560px); gap: 16px">
      {#each SEEDS as s, i (s.id)}
        {@const tile = tileOf(s.id)}
        {#if tile}
          <div style="height: 340px; display: flex">
            <SessionTile {tile} {now} tailing pinned={i === 0} focused={i === 3} focusVisible={false} />
          </div>
        {/if}
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Tile, no transcript" beforeEach={sessions}>
  {#snippet template()}
    {@const tile = tileOf("s-metrics")}
    {#if tile}
      <div style="width: 560px; height: 340px; display: flex">
        <SessionTile {tile} {now} tailing={false} pinned={false} focused={false} focusVisible={false} />
      </div>
    {/if}
  {/snippet}
</Story>
