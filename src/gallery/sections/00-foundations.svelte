<script lang="ts">
  import GallerySection from "../GallerySection.svelte";

  const colours = [
    "bg",
    "surface",
    "surface2",
    "surface3",
    "border",
    "border2",
    "text",
    "muted",
    "accent",
    "warn",
    "danger",
    "ink",
  ];
  const sizes = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"];
  const radii = ["xs", "sm", "md", "lg", "card", "card-lg", "modal"];
</script>

<GallerySection title="Foundations" states={["light", "dark"]}>
  <h3>Colour</h3>
  <div class="row">
    {#each colours as c (c)}
      <div class="sw">
        <span class="chip" style:background={`var(--${c})`}></span>
        <code>--{c}</code>
      </div>
    {/each}
  </div>
  <h3>Type scale</h3>
  {#each sizes as s (s)}
    <p style:font-size={`var(--fs-${s})`} class="type">
      <code>--fs-{s}</code> The quick brown fox
    </p>
  {/each}
  <h3>Radii</h3>
  <div class="row">
    {#each radii as r (r)}
      <div class="sw">
        <span class="chip" style:border-radius={`var(--r-${r})`}></span>
        <code>--r-{r}</code>
      </div>
    {/each}
  </div>
</GallerySection>

<style>
  h3 {
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
    margin: 16px 0 8px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .sw {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .chip {
    width: 72px;
    height: 40px;
    border: 1px solid var(--border2);
  }
  .type {
    margin: 4px 0;
  }
  code {
    font-family: var(--font-mono);
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
</style>
