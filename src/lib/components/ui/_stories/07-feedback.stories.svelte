<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Empty from "../empty/index.js";
  import { Skeleton } from "../skeleton/index.js";
  import { Spinner } from "../spinner/index.js";
  import { Progress } from "../progress/index.js";
  import { Button } from "../button/index.js";
  import Icon from "../icon/icon.svelte";

  const { Story } = defineMeta({ title: "UI/Empty, Skeleton, Spinner, Progress", tags: ["autodocs"] });
</script>

<Story name="Empty" asChild>
  <div class="grid max-w-[420px] gap-6">
    <div class="rounded-xl border border-border bg-card">
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><Icon name="fork_right" size={20} /></Empty.Media>
          <Empty.Title>No open pull requests</Empty.Title>
          <Empty.Description>Pull requests you author or review in watched repositories show up here.</Empty.Description>
        </Empty.Header>
        <Empty.Content><Button size="sm" variant="outline">Watch a repository</Button></Empty.Content>
      </Empty.Root>
    </div>
    <div class="rounded-lg border border-border bg-card p-1">
      <Empty.Root size="compact">
        <Empty.Media><Icon name="info" /></Empty.Media>
        <Empty.Title>No subagents yet</Empty.Title>
      </Empty.Root>
    </div>
  </div>
</Story>

<Story name="Skeleton, Spinner, Progress" asChild>
  <div class="grid max-w-[360px] gap-6">
    <div class="grid gap-2 rounded-xl border border-border bg-card p-3.5">
      <Skeleton class="w-2/3" />
      <Skeleton class="w-full" />
      <Skeleton class="w-1/2" />
    </div>
    <div class="flex items-center gap-2 text-caption text-muted-foreground"><Spinner /> Loading pull requests…</div>
    <div class="grid gap-3">
      <Progress value={32} />
      <Progress value={81} indicatorClass="bg-warning" />
      <Progress value={100} />
    </div>
  </div>
</Story>
