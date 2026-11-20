<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { Button } from "../button/index.js";
  import * as ButtonGroup from "../button-group/index.js";
  import Icon from "../icon/icon.svelte";
  import Kbd from "../kbd/kbd.svelte";

  const { Story } = defineMeta({
    title: "UI/Button",
    component: Button,
    tags: ["autodocs"],
    args: { variant: "default", size: "default", disabled: false, loading: false },
    argTypes: {
      variant: { control: "select", options: ["default", "outline", "secondary", "ghost", "destructive", "link"] },
      size: { control: "select", options: ["xs", "sm", "default", "lg", "icon-xs", "icon-sm", "icon", "icon-lg"] },
    },
  });

  const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
  const sizes = ["xs", "sm", "default", "lg"] as const;
  const iconSizes = [
    ["icon-xs", 16],
    ["icon-sm", 16],
    ["icon", 18],
    ["icon-lg", 18],
  ] as const;
</script>

<Story name="Playground">
  {#snippet template(args)}
    <Button {...args}>New session</Button>
  {/snippet}
</Story>

<Story name="Variants" asChild>
  <div class="flex flex-wrap items-center gap-3">
    {#each variants as variant (variant)}
      <Button {variant}>{variant}</Button>
    {/each}
  </div>
</Story>

<Story name="Sizes" asChild>
  <div class="grid gap-3">
    {#each sizes as size (size)}
      <div class="flex items-center gap-3">
        <span class="w-16 font-mono text-xs text-muted-foreground">{size}</span>
        <Button {size}>
          <Icon name="add" size={size === "xs" || size === "sm" ? 16 : 18} />
          New session
        </Button>
        <Button {size} variant="outline">Cancel</Button>
        <Button {size} variant="ghost">Ghost</Button>
      </div>
    {/each}
    <div class="flex items-center gap-3">
      <span class="w-16 font-mono text-xs text-muted-foreground">icon</span>
      {#each iconSizes as [size, px] (size)}
        <Button {size} variant="ghost" aria-label="Settings"><Icon name="settings" size={px} /></Button>
      {/each}
      {#each iconSizes as [size, px] (size)}
        <Button {size} variant="outline" aria-label="Close"><Icon name="close" size={px} /></Button>
      {/each}
    </div>
  </div>
</Story>

<Story name="States" asChild>
  <div class="flex flex-wrap items-center gap-3">
    <Button disabled>Disabled</Button>
    <Button variant="outline" disabled>Disabled outline</Button>
    <Button loading><Icon name="refresh" size={18} />Refreshing</Button>
    <Button variant="outline" loading><Icon name="refresh" size={18} />Refreshing</Button>
    <Button variant="ghost" aria-expanded="true">Expanded</Button>
    <Button>Create <Kbd>⏎</Kbd></Button>
    <Button variant="link" href="#x">Open plan file →</Button>
  </div>
</Story>

<Story name="Button group" asChild>
  <ButtonGroup.Root>
    <Button variant="outline" size="sm">Unified</Button>
    <Button variant="outline" size="sm">Split</Button>
    <Button variant="outline" size="sm" aria-label="More"><Icon name="more_horiz" /></Button>
  </ButtonGroup.Root>
</Story>
