<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Card from "../card/index.js";
  import * as Table from "../table/index.js";
  import * as Avatar from "../avatar/index.js";
  import * as Collapsible from "../collapsible/index.js";
  import { ScrollArea } from "../scroll-area/index.js";
  import { Button } from "../button/index.js";
  import Icon from "../icon/icon.svelte";

  const { Story } = defineMeta({
    title: "UI/Card, Table, Avatar, Collapsible",
    tags: ["autodocs"],
  });

  const rows = [
    ["Opus", "41", "$18.20", "Long plans and reviews"],
    ["Sonnet", "212", "$9.75", "Most sessions"],
    ["Haiku", "88", "$0.61", "Subagents and summaries"],
  ];
</script>

<Story name="Card" asChild>
  <div class="grid max-w-[360px] gap-4">
    <Card.Root>
      <Card.Header>
        <Card.Title>Spend this week</Card.Title>
        <Card.Action
          ><Button variant="ghost" size="icon-sm" aria-label="More"
            ><Icon name="more_horiz" /></Button
          ></Card.Action
        >
        <Card.Description>Across 14 sessions in 3 workspaces</Card.Description>
      </Card.Header>
      <Card.Content><span class="font-mono text-2xl tabular-nums">$28.56</span></Card.Content>
      <Card.Footer
        ><span class="text-caption text-muted-foreground">Up 12% on last week</span></Card.Footer
      >
    </Card.Root>
  </div>
</Story>

<Story name="Table" asChild>
  <div class="max-w-[620px] overflow-hidden rounded-xl border border-border bg-card">
    <Table.Root>
      <Table.Header>
        <Table.Row
          ><Table.Head>Model</Table.Head><Table.Head>Sessions</Table.Head><Table.Head
            >Cost</Table.Head
          ><Table.Head>Used for</Table.Head></Table.Row
        >
      </Table.Header>
      <Table.Body>
        {#each rows as r (r[0])}
          <Table.Row>
            <Table.Cell>{r[0]}</Table.Cell><Table.Cell class="font-mono tabular-nums"
              >{r[1]}</Table.Cell
            >
            <Table.Cell class="font-mono tabular-nums">{r[2]}</Table.Cell><Table.Cell
              >{r[3]}</Table.Cell
            >
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</Story>

<Story name="Avatar" asChild>
  <div class="flex items-center gap-3">
    <Avatar.Root size="sm"><Avatar.Fallback>JH</Avatar.Fallback></Avatar.Root>
    <Avatar.Root><Avatar.Fallback>JH</Avatar.Fallback></Avatar.Root>
    <Avatar.Root size="lg"><Avatar.Fallback>GH</Avatar.Fallback></Avatar.Root>
  </div>
</Story>

<Story name="Collapsible and scroll area" asChild>
  <div class="grid max-w-[320px] gap-4">
    <Collapsible.Root open class="rounded-xl border border-border bg-card p-3">
      <Collapsible.Trigger class="group flex w-full items-center gap-2 text-sm font-medium">
        <Icon name="chevron_right" class="transition-transform group-data-[state=open]:rotate-90" />
        3 agents
      </Collapsible.Trigger>
      <Collapsible.Content class="mt-2 grid gap-1 pl-6 text-caption text-muted-foreground">
        <span>Explore: reading src/lib/stores</span><span>Plan: drafting phases</span><span
          >Review: idle</span
        >
      </Collapsible.Content>
    </Collapsible.Root>
    <ScrollArea class="h-32 rounded-lg border border-border bg-card">
      <div class="grid gap-1 p-3 text-caption">
        {#each Array.from({ length: 20 }, (_, i) => i + 1) as n (n)}<span>Line {n}</span>{/each}
      </div>
    </ScrollArea>
  </div>
</Story>
