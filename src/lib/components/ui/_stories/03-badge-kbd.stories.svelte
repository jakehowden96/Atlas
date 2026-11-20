<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { Badge } from "../badge/index.js";
  import { Kbd, KbdGroup } from "../kbd/index.js";
  import { Button } from "../button/index.js";
  import Icon from "../icon/icon.svelte";

  const { Story } = defineMeta({ title: "UI/Badge, Kbd", tags: ["autodocs"] });

  const variants = ["default", "secondary", "outline", "success", "warning", "destructive", "muted"] as const;
</script>

<Story name="Badge" asChild>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center gap-2">
      {#each variants as variant (variant)}<Badge {variant}>{variant}</Badge>{/each}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="success">In Progress</Badge>
      <Badge variant="warning">In Review</Badge>
      <Badge variant="muted">Done</Badge>
      <Badge variant="outline">Todo</Badge>
      <Badge variant="destructive"><Icon name="error" /> 2 failing</Badge>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-mono text-xs text-muted-foreground">sm (count)</span>
      <Badge variant="secondary" size="sm">3</Badge>
      <Badge variant="secondary" size="sm">12</Badge>
      <Badge size="sm">99+</Badge>
      <span class="ml-4 font-mono text-xs text-muted-foreground">lg</span>
      <Badge size="lg" variant="outline">feat/rail-v6</Badge>
    </div>
  </div>
</Story>

<Story name="Kbd" asChild>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
      <Kbd>Esc</Kbd>
      <Kbd>⏎</Kbd>
      <KbdGroup><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>P</Kbd></KbdGroup>
      <KbdGroup><Kbd>Ctrl</Kbd><Kbd>\</Kbd></KbdGroup>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <Button>Create <Kbd>⏎</Kbd></Button>
      <Button variant="outline">Jump <Kbd>⌘K</Kbd></Button>
    </div>
  </div>
</Story>
