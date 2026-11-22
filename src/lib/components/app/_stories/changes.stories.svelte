<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ChangesDrawer from "../changes/ChangesDrawer.svelte";
  import DiffFileCard from "../changes/DiffFileCard.svelte";
  import DiffFileTree from "../changes/DiffFileTree.svelte";
  import DiffCommentThread from "../changes/DiffCommentThread.svelte";
  import { parseDiff } from "$lib/diff-parser";
  import { toFlat } from "$lib/diff-view";
  import { panelData } from "$lib/stores/panel";
  import { diffOpen } from "$lib/stores/view";
  import type { ReviewAnchor, ReviewComment } from "$lib/stores/reviewComments";
  import { BILLING, DIFF, FOCUSED, panel, seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Changes",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const files = parseDiff(DIFF).map((f, i) => toFlat(f, `f${i}`));
  const anchor: ReviewAnchor = {
    fileKey: "f0",
    side: "+",
    oldNum: null,
    newNum: 12,
    hunkHeader: "@@ -8,6 +8,14 @@",
    contentSnippet: "let delay = backoff(attempt);",
  };
  const comment: ReviewComment = {
    id: "c1",
    sessionId: `tab-${FOCUSED}`,
    anchor,
    body: "Cap this at 30s so a long outage doesn't stall the queue.",
    createdAt: Date.now() - 120_000,
  };
  const noop = () => {};
  const drawer = () => (seedWorld("session"), panelData.set(panel(BILLING)), diffOpen.set(true));
</script>

<Story name="Drawer" parameters={{ layout: "fullscreen" }} beforeEach={drawer}>
  {#snippet template()}<div style="height: 100vh; display: flex"><ChangesDrawer open /></div>{/snippet}
</Story>

<Story name="File tree">
  {#snippet template()}
    <div style="width: 260px">
      <DiffFileTree flatFiles={files} viewedFiles={new Set(["f0"])} onSelectFile={noop} onToggleViewed={noop} />
    </div>
  {/snippet}
</Story>

{#snippet card(diffMode: "split" | "unified")}
  <DiffFileCard
    item={files[0]!}
    {diffMode}
    viewed={false}
    userCollapsed={false}
    expanded={false}
    overBudget={false}
    commentsByAnchorKey={new Map()}
    composerKey={null}
    onToggleViewed={noop}
    onToggleCollapsed={noop}
    onToggleExpand={noop}
    onOpenComposer={noop}
    onCloseComposer={noop}
    onSaveComment={noop}
    onDismissComment={noop}
  />
{/snippet}

<Story name="File card, split">
  {#snippet template()}{@render card("split")}{/snippet}
</Story>

<Story name="File card, unified">
  {#snippet template()}{@render card("unified")}{/snippet}
</Story>

<Story name="Comment thread">
  {#snippet template()}
    <div style="width: 640px">
      <DiffCommentThread {anchor} comments={[comment]} composerOpen={false} onClose={noop} onSave={noop} onDismiss={noop} />
    </div>
  {/snippet}
</Story>

<Story name="Comment thread, composing">
  {#snippet template()}
    <div style="width: 640px">
      <DiffCommentThread {anchor} comments={[]} composerOpen onClose={noop} onSave={noop} onDismiss={noop} />
    </div>
  {/snippet}
</Story>
