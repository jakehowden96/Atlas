<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Tabs from "../tabs/index.js";
  import * as ToggleGroup from "../toggle-group/index.js";
  import * as Item from "../item/index.js";
  import { Separator } from "../separator/index.js";
  import { Button } from "../button/index.js";
  import { Badge } from "../badge/index.js";
  import Icon from "../icon/icon.svelte";

  const { Story } = defineMeta({ title: "UI/Tabs, Toggle group, Item, Separator", tags: ["autodocs"] });

  const files = [
    { name: "ActivityRail.svelte", path: "src/lib/components/app/session", selected: false },
    { name: "app.css", path: "src", selected: true },
    { name: "theme.ts", path: "src/lib", selected: false },
  ];
</script>

<Story name="Tabs" asChild>
  <div class="grid gap-6">
    <Tabs.Root value="sessions">
      <Tabs.List>
        <Tabs.Trigger value="sessions">Sessions</Tabs.Trigger>
        <Tabs.Trigger value="files">Files</Tabs.Trigger>
        <Tabs.Trigger value="prs">Pull requests</Tabs.Trigger>
        <Tabs.Trigger value="stats">Stats</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
    <Tabs.Root value="files">
      <Tabs.List size="lg">
        <Tabs.Trigger value="sessions">Sessions</Tabs.Trigger>
        <Tabs.Trigger value="files">Files</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
    <Tabs.Root value="a" class="max-w-[520px]">
      <Tabs.List variant="line" class="w-full justify-start">
        <Tabs.Trigger value="a">app.css</Tabs.Trigger>
        <Tabs.Trigger value="b">theme.ts</Tabs.Trigger>
        <Tabs.Trigger value="c">ActivityRail.svelte</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
    <Tabs.Root value="connectors" orientation="vertical" class="max-w-[220px] rounded-lg bg-sidebar p-2">
      <Tabs.List>
        <Tabs.Trigger value="general">General</Tabs.Trigger>
        <Tabs.Trigger value="workspaces">Workspaces</Tabs.Trigger>
        <Tabs.Trigger value="connectors">Connectors</Tabs.Trigger>
        <Tabs.Trigger value="keyboard">Keyboard</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  </div>
</Story>

<Story name="Toggle group" asChild>
  <div class="flex flex-wrap items-center gap-4">
    <ToggleGroup.Root type="single" value="7d">
      <ToggleGroup.Item value="24h">24h</ToggleGroup.Item>
      <ToggleGroup.Item value="7d">7d</ToggleGroup.Item>
      <ToggleGroup.Item value="30d">30d</ToggleGroup.Item>
      <ToggleGroup.Item value="all">All</ToggleGroup.Item>
    </ToggleGroup.Root>
    <ToggleGroup.Root type="single" value="unified" size="lg">
      <ToggleGroup.Item value="unified">Unified</ToggleGroup.Item>
      <ToggleGroup.Item value="split">Split</ToggleGroup.Item>
    </ToggleGroup.Root>
    <ToggleGroup.Root type="multiple" value={["failing", "mine"]}>
      <ToggleGroup.Item value="failing">Failing</ToggleGroup.Item>
      <ToggleGroup.Item value="mine">Mine</ToggleGroup.Item>
      <ToggleGroup.Item value="drafts">Drafts</ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>
</Story>

<Story name="Item" asChild>
  <div class="grid max-w-[420px] gap-6">
    <Item.Group>
      {#each files as f (f.name)}
        <Item.Root data-selected={f.selected || undefined} tabindex={0}>
          <Item.Media><Icon name="description" /></Item.Media>
          <Item.Content><Item.Title>{f.name}</Item.Title></Item.Content>
          <Item.Actions reveal>
            <Button variant="ghost" size="icon-xs" aria-label="Copy path"><Icon name="content_copy" /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="More"><Icon name="more_horiz" /></Button>
          </Item.Actions>
        </Item.Root>
      {/each}
      <Item.Root data-disabled="true">
        <Item.Media><Icon name="folder" /></Item.Media>
        <Item.Content><Item.Title>node_modules (ignored)</Item.Title></Item.Content>
      </Item.Root>
    </Item.Group>
    <Item.Group class="gap-2">
      <Item.Root variant="outline">
        <Item.Media><Icon name="key" size={18} /></Item.Media>
        <Item.Content>
          <Item.Title>GitHub</Item.Title>
          <Item.Description>Linked as jakehowden · 4 repositories watched</Item.Description>
        </Item.Content>
        <Item.Actions><Badge variant="success">Linked</Badge><Button size="sm" variant="outline">Manage</Button></Item.Actions>
      </Item.Root>
      <Item.Root variant="outline">
        <Item.Media><Icon name="confirmation_number" size={18} /></Item.Media>
        <Item.Content>
          <Item.Title>Linear</Item.Title>
          <Item.Description>Not linked</Item.Description>
        </Item.Content>
        <Item.Actions><Button size="sm">Link</Button></Item.Actions>
      </Item.Root>
    </Item.Group>
  </div>
</Story>

<Story name="Separator" asChild>
  <div class="grid max-w-[320px] gap-3 text-caption">
    <span>Above</span>
    <Separator />
    <div class="flex h-5 items-center gap-3">
      <span>Left</span><Separator orientation="vertical" /><span>Right</span>
    </div>
  </div>
</Story>
