<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Icon, { ICONS } from "../icon/icon.svelte";

  const { Story } = defineMeta({ title: "UI/Theme", tags: ["autodocs"] });

  const pairs = [
    ["background", "foreground"],
    ["card", "card-foreground"],
    ["popover", "popover-foreground"],
    ["primary", "primary-foreground"],
    ["secondary", "secondary-foreground"],
    ["muted", "muted-foreground"],
    ["accent", "accent-foreground"],
    ["success", "success-foreground"],
    ["warning", "warning-foreground"],
    ["destructive", "destructive-foreground"],
  ] as const;
  const lines = ["border", "input", "ring"] as const;
  const series = [
    "chart-1",
    "chart-2",
    "chart-3",
    "chart-4",
    "chart-5",
    "model-opus",
    "model-sonnet",
    "model-haiku",
  ];
  const type = [
    ["text-2xl", "24 · page titles"],
    ["text-xl", "19 · section and stat headings"],
    ["text-lg", "16 · ticket title"],
    ["text-md", "15 · palette input, meter values"],
    ["text-sm", "14 · body, buttons, inputs, menu rows"],
    ["text-caption", "13 · secondary lines, small controls"],
    ["text-xs", "12 · labels, meta, kbd (the floor)"],
  ] as const;
  const radii = [
    "rounded-xs",
    "rounded-sm",
    "rounded-md",
    "rounded-lg",
    "rounded-xl",
    "rounded-full",
  ];
</script>

<Story name="Colours" asChild>
  <div class="grid max-w-[900px] gap-6">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
      {#each pairs as [bg, fg] (bg)}
        <div class="overflow-hidden rounded-lg border border-border">
          <div
            class="flex h-14 items-end p-2 text-caption font-medium"
            style:background="var(--{bg})"
            style:color="var(--{fg})"
          >
            Aa {bg}
          </div>
          <div class="bg-card px-2 py-1 font-mono text-xs text-muted-foreground">
            --{bg} / --{fg}
          </div>
        </div>
      {/each}
    </div>
    <div class="flex flex-wrap gap-3">
      {#each lines as l (l)}
        <div class="flex items-center gap-2 rounded-lg bg-card p-2 pr-3 text-caption">
          <span class="size-8 rounded-md" style:box-shadow="inset 0 0 0 2px var(--{l})"></span>--{l}
        </div>
      {/each}
      {#each ["elev-0", "elev-1", "elev-2"] as e (e)}
        <div
          class="grid h-12 w-28 place-items-center rounded-lg bg-card text-caption"
          style:box-shadow="var(--{e})"
        >
          --{e}
        </div>
      {/each}
    </div>
    <div class="flex flex-wrap gap-2">
      {#each series as s (s)}
        <div class="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <span class="size-3 rounded-full" style:background="var(--{s})"></span>--{s}
        </div>
      {/each}
    </div>
  </div>
</Story>

<Story name="Type and radius" asChild>
  <div class="grid gap-6">
    <div class="grid gap-2">
      {#each type as [cls, note] (cls)}
        <div class="flex items-baseline gap-4">
          <span class="w-28 font-mono text-xs text-muted-foreground">{cls}</span>
          <span class={cls}>Session needs you · 3 checks failing</span>
          <span class="text-xs text-muted-foreground">{note}</span>
        </div>
      {/each}
      <div class="flex items-baseline gap-4">
        <span class="w-28 font-mono text-xs text-muted-foreground">font-mono</span>
        <span class="font-mono text-caption">ATL-142 · feat/rail-v6 · $0.42</span>
      </div>
    </div>
    <div class="flex gap-4">
      {#each radii as r (r)}
        <div class="grid gap-1 text-center font-mono text-xs text-muted-foreground">
          <span class="size-12 border border-input bg-card {r}"></span>{r}
        </div>
      {/each}
    </div>
  </div>
</Story>

<Story name="Icons" asChild>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
    {#each ICONS as name (name)}
      <div class="flex items-center gap-2 rounded-md bg-card px-2 py-1.5 text-caption">
        <Icon {name} size={18} />
        <span class="truncate font-mono text-xs text-muted-foreground">{name}</span>
      </div>
    {/each}
  </div>
</Story>
