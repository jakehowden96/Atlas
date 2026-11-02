<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import Button from "../../lib/components/ui/Button.svelte";
  import IconButton from "../../lib/components/ui/IconButton.svelte";
  import Icon from "../../lib/components/ui/Icon.svelte";

  const variants = ["primary", "secondary", "ghost", "danger", "link"] as const;
  const sizes = ["sm", "md", "lg"] as const;
  const iconVariants = ["primary", "secondary", "ghost", "danger"] as const;
</script>

{#snippet plus()}<Icon name="add" />{/snippet}

<GallerySection title="Button" states={["default", "hover", "focus", "disabled", "loading"]}>
  {#each variants as v (v)}
    {#each sizes as s (s)}
      <div class="row">
        <code>{v} {s}</code>
        <Button variant={v} size={s}>Label</Button>
        <Button variant={v} size={s} leading={plus}>With icon</Button>
        <Button variant={v} size={s} disabled>Disabled</Button>
        <Button variant={v} size={s} loading>Loading</Button>
        <Button variant={v} size={s} loading leading={plus}>Loading icon</Button>
      </div>
    {/each}
  {/each}
  <h3>Icon only</h3>
  {#each iconVariants as v (v)}
    <div class="row">
      <code>{v}</code>
      {#each sizes as s (s)}
        <IconButton variant={v} size={s} icon="settings" label="Settings" />
      {/each}
      <IconButton variant={v} icon="settings" label="Settings" disabled />
    </div>
  {/each}
</GallerySection>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  code {
    width: 110px;
    font-family: var(--font-mono);
    color: var(--muted);
    font-size: var(--fs-2xs);
  }
  h3 {
    font-size: var(--fs-sm);
    font-weight: var(--fw-semi);
    margin: 16px 0 8px;
  }
</style>
