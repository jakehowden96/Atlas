<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import SessionView from "../session/SessionView.svelte";
  import ActivityRail from "../session/ActivityRail.svelte";
  import JumpPalette from "../session/JumpPalette.svelte";
  import NewSessionModal from "../session/NewSessionModal.svelte";
  import AgentsTile from "../session/rail/AgentsTile.svelte";
  import HeadlineText from "../session/rail/HeadlineText.svelte";
  import MeterStrip from "../session/rail/MeterStrip.svelte";
  import PlanTile from "../session/rail/PlanTile.svelte";
  import RailGroup from "../session/rail/RailGroup.svelte";
  import RailHeader from "../session/rail/RailHeader.svelte";
  import RailRow from "../session/rail/RailRow.svelte";
  import RailTicket from "../session/rail/RailTicket.svelte";
  import ThinRail from "../session/rail/ThinRail.svelte";
  import TicketEditor from "../session/rail/TicketEditor.svelte";
  import Tile from "../session/rail/Tile.svelte";
  import { railTiles } from "$lib/stores/settings";
  import { jumpOpen, newSessionOpen, railWidth } from "$lib/stores/view";
  import { FOCUSED, seedWorld, tileOf, worldBackend } from "$lib/storybook/fixtures/world";
  import type { RailRowData } from "$lib/session-view";
  import type { Snippet } from "svelte";

  const { Story } = defineMeta({
    title: "App/Session",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const session = () => seedWorld("session");
  const now = Date.now();
  const rows: RailRowData[] = [
    { title: "e2e (webkit)", state: "failing", word: "Failed", rest: " · 3m", href: "#", linkLabel: "Details" },
    { title: "lint", state: "running", word: "Running", rest: " · 40s" },
    { title: "unit", state: "done", word: "Passed", rest: "" },
    { title: "Explore", state: "running", word: "Reading", rest: "", meta: "Explore", chip: "wt-2", action: "src/retry.rs" },
  ];
</script>

<!-- The rail's expanded width (ActivityRail.svelte). -->
{#snippet rail(children: Snippet)}
  <div style="width: 300px">{@render children()}</div>
{/snippet}

<Story name="Session view" parameters={{ layout: "fullscreen" }} beforeEach={session}>
  {#snippet template()}<div style="height: 100vh; display: flex"><SessionView /></div>{/snippet}
</Story>

<Story name="Activity rail" beforeEach={session}>
  {#snippet template()}
    <div style="height: 640px; display: flex"><ActivityRail tile={tileOf(FOCUSED)} {now} /></div>
  {/snippet}
</Story>

<Story name="Activity rail, thin" beforeEach={() => (session(), railWidth.set("thin"))}>
  {#snippet template()}
    <div style="height: 640px; display: flex"><ActivityRail tile={tileOf(FOCUSED)} {now} /></div>
  {/snippet}
</Story>

<Story name="Activity rail, no session" beforeEach={session}>
  {#snippet template()}
    <div style="height: 640px; display: flex"><ActivityRail tile={null} {now} /></div>
  {/snippet}
</Story>

<Story name="Rail header" beforeEach={session}>
  {#snippet template()}{#snippet c()}<RailHeader tile={tileOf(FOCUSED)} {now} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Rail header, needs you" beforeEach={session}>
  {#snippet template()}{#snippet c()}<RailHeader tile={tileOf("s-pinned")} {now} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Meter strip" beforeEach={session}>
  {#snippet template()}{#snippet c()}<MeterStrip live={tileOf("s-retry")?.live ?? null} {now} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Ticket" beforeEach={session}>
  {#snippet template()}{#snippet c()}<RailTicket sessionId={FOCUSED} branch="atlas/billing-retry" branchLine="atlas/billing-retry · 3 files" />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Ticket, none linked" beforeEach={session}>
  {#snippet template()}{#snippet c()}<RailTicket sessionId="s-metrics" branch="main" branchLine="main" />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Ticket editor" beforeEach={session}>
  {#snippet template()}{#snippet c()}<TicketEditor sessionId={FOCUSED} branch="atlas/billing-retry" initial="ENG-482" onclose={() => {}} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Plan tile" beforeEach={() => (session(), railTiles.set({ plan: true }))}>
  {#snippet template()}{#snippet c()}<PlanTile plan={tileOf(FOCUSED)?.live.plan ?? []} workspacePath={tileOf(FOCUSED)?.workspacePath} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Plan tile, no plan" beforeEach={session}>
  {#snippet template()}{#snippet c()}<PlanTile plan={[]} workspacePath={undefined} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Agents tile" beforeEach={() => (session(), railTiles.set({ agents: true }))}>
  {#snippet template()}{#snippet c()}<AgentsTile agents={tileOf("s-retry")?.live.subagents ?? []} worktree={null} {now} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Agents tile, none" beforeEach={session}>
  {#snippet template()}{#snippet c()}<AgentsTile agents={[]} worktree={null} {now} />{/snippet}{@render rail(c)}{/snippet}
</Story>

<Story name="Tile (generic)" beforeEach={() => railTiles.set({ plan: true })}>
  {#snippet template()}
    {#snippet c()}
      <Tile key="plan" label="Plan" state="running">
        {#snippet headline()}<HeadlineText h={{ lead: "Step 3 of 6:", rest: " Wrap sendWebhook in the helper", tone: "text" }} />{/snippet}
        {#snippet detail()}<span>3 done</span>{/snippet}
        <RailGroup {rows} />
      </Tile>
    {/snippet}
    {@render rail(c)}
  {/snippet}
</Story>

<Story name="Rail rows">
  {#snippet template()}
    {#snippet c()}
      {#each rows as row (row.title)}<RailRow {row} />{/each}
      <RailGroup rows={[...rows, ...rows.map((r) => ({ ...r, title: `${r.title} 2` }))]} noun="checks" fold="passed" />
    {/snippet}
    {@render rail(c)}
  {/snippet}
</Story>

<Story name="Headline text">
  {#snippet template()}
    <p><HeadlineText h={{ lead: "Step 11 of 14:", rest: " Parse Retry-After as an HTTP date", tone: "text" }} /></p>
    <p><HeadlineText h={{ lead: "2 failing", rest: " · e2e, lint", tone: "accent" }} /></p>
    <p><HeadlineText h={{ lead: "", rest: "No plan yet", tone: "muted" }} restMuted /></p>
  {/snippet}
</Story>

<Story name="Thin rail">
  {#snippet template()}
    <div style="width: 48px; height: 400px; display: flex">
      <ThinRail
        marks={[
          { key: "plan", letter: "P", state: "running", sentence: "Step 3 of 6" },
          { key: "agents", letter: "A", state: "idle", sentence: "No agents" },
          { key: "pr", letter: "PR", state: "failing", sentence: "#482: 1 of 7 failing" },
        ]}
        waiting
        ticketId="ENG-482"
        onexpand={() => {}}
      />
    </div>
  {/snippet}
</Story>

<Story name="Jump palette" parameters={{ layout: "fullscreen" }} beforeEach={() => (seedWorld("sessions"), jumpOpen.set(true))}>
  {#snippet template()}<JumpPalette />{/snippet}
</Story>

<Story name="New session" parameters={{ layout: "fullscreen" }} beforeEach={() => (seedWorld("sessions"), newSessionOpen.set(true))}>
  {#snippet template()}<NewSessionModal />{/snippet}
</Story>
