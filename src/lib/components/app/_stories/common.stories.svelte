<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Segmented from "../common/Segmented.svelte";
  import TabStrip from "../common/TabStrip.svelte";
  import OptionSelect from "../common/OptionSelect.svelte";
  import SearchInput from "../common/SearchInput.svelte";
  import MenuButton from "../common/MenuButton.svelte";
  import AnchoredPopover from "../common/AnchoredPopover.svelte";
  import TooltipButton from "../common/TooltipButton.svelte";
  import CopyButton from "../common/CopyButton.svelte";
  import ChipInput from "../common/ChipInput.svelte";
  import NumberStepper from "../common/NumberStepper.svelte";
  import StatusMark from "../common/StatusMark.svelte";
  import StatePill from "../common/StatePill.svelte";
  import { Button } from "$lib/components/ui/button/index.js";

  const { Story } = defineMeta({ title: "App/Common", tags: ["autodocs"] });

  const segs = [
    { id: "sessions", label: "Sessions", count: 4 },
    { id: "files", label: "Files", dot: true },
    { id: "prs", label: "PRs", count: 2, alert: true },
    { id: "stats", label: "Stats", disabled: true },
  ];
  const files = [
    "App.svelte",
    "app.css",
    "theme.ts",
    "TopBar.svelte",
    "SessionView.svelte",
    "FileTree.svelte",
    "StatsView.svelte",
  ].map((f, i) => ({ id: f, label: f, dirty: i === 1 }));
  const menu = [
    { id: "open", label: "Open", icon: "open_in_new" as const, shortcut: "Enter" },
    { id: "rename", label: "Rename" },
    {
      id: "share",
      label: "Share",
      children: [
        { id: "link", label: "Copy link" },
        { id: "mail", label: "Email" },
      ],
    },
    { id: "lock", label: "Locked", disabled: true },
    { id: "delete", label: "Delete", danger: true, separatorBefore: true },
  ];
</script>

<script lang="ts">
  let seg = $state("sessions");
  let range = $state("7d");
  let file = $state("app.css");
  let pick = $state("updated");
  let q = $state("");
  let popOpen = $state(false);
  let popTrigger = $state<HTMLElement | null>(null);
  let chips = $state(["main", "release/*"]);
  let n = $state(3);
</script>

<Story name="Segmented" asChild>
  <div class="flex flex-col items-start gap-4 p-6">
    <Segmented options={segs} value={seg} onChange={(v) => (seg = v)} label="View" />
    <Segmented
      role="radiogroup"
      size="sm"
      label="Range"
      options={[
        { id: "1d", label: "1d" },
        { id: "7d", label: "7d" },
        { id: "30d", label: "30d" },
      ]}
      value={range}
      onChange={(v) => (range = v)}
    />
  </div>
</Story>

<Story name="Tab strip" asChild>
  <div class="flex flex-col gap-6 p-6">
    <div class="w-[460px] border-b border-border">
      <TabStrip
        label="Open files"
        tabs={files}
        value={file}
        onselect={(id) => (file = id)}
        onclose={() => {}}
      />
    </div>
    <div class="w-56">
      <TabStrip
        vertical
        label="Settings sections"
        tabs={[
          { id: "general", label: "General", group: "App" },
          { id: "keys", label: "Keyboard", group: "App" },
          { id: "claude", label: "Claude Code", group: "Harnesses" },
        ]}
        value="keys"
        onselect={() => {}}
      />
    </div>
  </div>
</Story>

<Story name="Select, search, menu" asChild>
  <div class="flex flex-wrap items-center gap-3 p-6">
    <OptionSelect
      size="sm"
      aria-label="Sort"
      options={[
        { id: "updated", label: "Recently updated" },
        { id: "created", label: "Newest" },
        { id: "author", label: "Author" },
      ]}
      bind:value={pick}
    />
    <OptionSelect
      aria-label="Plan"
      placeholder="Choose a plan"
      options={[{ id: "pro", label: "Pro" }]}
    />
    <div class="w-64">
      <SearchInput bind:value={q} placeholder="Search files" aria-label="Search files" />
    </div>
    <MenuButton label="Actions" items={menu} />
    <MenuButton icon="more_horiz" label="Ticket actions" items={menu} align="end" />
  </div>
</Story>

<Story name="Anchored popover" asChild>
  <div class="p-6">
    <Button variant="outline" bind:ref={popTrigger} onclick={() => (popOpen = !popOpen)}
      >Session status</Button
    >
    <AnchoredPopover bind:open={popOpen} trigger={popTrigger} label="Session status">
      <div class="flex items-center gap-2">
        <StatusMark state="running" /> 2 running · 1 needs you
      </div>
    </AnchoredPopover>
  </div>
</Story>

<Story name="Buttons and inputs" asChild>
  <div class="flex flex-col items-start gap-4 p-6">
    <div class="flex items-center gap-2">
      <TooltipButton icon="search" label="Jump to" shortcut="Ctrl K" />
      <TooltipButton icon="settings" label="Settings" size="sm" />
      <CopyButton value="atlas" />
      <CopyButton value="atlas" variant="text" label="Copy path" />
    </div>
    <div class="w-80">
      <ChipInput bind:value={chips} label="Branches" placeholder="Add a branch" />
    </div>
    <NumberStepper bind:value={n} min={0} max={10} label="Columns" />
  </div>
</Story>

<Story name="Status" asChild>
  <div class="flex items-center gap-4 p-6">
    {#each ["running", "attention", "failing", "done", "idle"] as const as s (s)}
      <span class="inline-flex items-center gap-1.5 text-sm"><StatusMark state={s} />{s}</span>
    {/each}
    {#each ["running", "needs", "idle", "error"] as const as s (s)}<StatePill state={s} />{/each}
  </div>
</Story>
