<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import PrsView from "../prs/PrsView.svelte";
  import PrRow from "../prs/PrRow.svelte";
  import PrChecks from "../prs/PrChecks.svelte";
  import { connectors } from "$lib/stores/connectors";
  import { toPr } from "$lib/stores/prs";
  import { watchedRepos } from "$lib/stores/settings";
  import { PRS, seedWorld, worldBackend } from "$lib/storybook/fixtures/world";
  import { checks, githubNotLinked, pull } from "$lib/storybook/fixtures/prs";

  const { Story } = defineMeta({
    title: "App/Pull requests",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const now = Date.now();
  const rows = Object.entries(PRS).flatMap(([repo, list]) => list.map((p) => toPr(p, repo)));
  const watched = () => (seedWorld("prs"), watchedRepos.set(Object.keys(PRS)));
</script>

<Story name="Screen" parameters={{ layout: "fullscreen" }} beforeEach={watched}>
  {#snippet template()}<div style="height: 100vh; display: flex; flex-direction: column"><PrsView /></div>{/snippet}
</Story>

<Story name="Screen, nothing watched" parameters={{ layout: "fullscreen" }} beforeEach={() => seedWorld("prs")}>
  {#snippet template()}<div style="height: 100vh; display: flex; flex-direction: column"><PrsView /></div>{/snippet}
</Story>

<Story name="Screen, no connector" parameters={{ layout: "fullscreen" }} beforeEach={() => (seedWorld("prs"), connectors.set([githubNotLinked]))}>
  {#snippet template()}<div style="height: 100vh; display: flex; flex-direction: column"><PrsView /></div>{/snippet}
</Story>

<Story name="Rows">
  {#snippet template()}
    <div style="border: 1px solid var(--border); border-radius: var(--radius-lg)">
      {#each rows as pr (pr.number)}<PrRow repo="octo/billing" {pr} {now} providerName="GitHub" />{/each}
    </div>
  {/snippet}
</Story>

<Story name="Checks, failing">
  {#snippet template()}<PrChecks pr={toPr(pull({ checks: checks.failing, review: { kind: "comments", count: 3 }, commentsCount: 3 }), "octo/billing")} />{/snippet}
</Story>

<Story name="Checks, running">
  {#snippet template()}<PrChecks pr={toPr(pull({ checks: checks.running }), "octo/billing")} />{/snippet}
</Story>

<Story name="Checks, none">
  {#snippet template()}<PrChecks pr={toPr(pull({ checks: [] }), "octo/billing")} />{/snippet}
</Story>
