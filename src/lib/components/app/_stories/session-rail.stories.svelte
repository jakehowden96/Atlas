<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import PrTile from "../session/rail/PrTile.svelte";
  import { connectors } from "$lib/stores/connectors";
  import { railTiles } from "$lib/stores/settings";
  import {
    checks,
    githubExpired,
    githubLinked,
    githubNotLinked,
    pull,
    workspace,
  } from "$lib/storybook/fixtures/prs";
  import type { PullRequest } from "../../../../types/generated/PullRequest";

  const { Story } = defineMeta({
    title: "App/Session rail/PR tile",
    tags: ["autodocs"],
    parameters: { layout: "padded" },
  });

  const repos = { list_workspace_repos: [{ path: workspace.path, slug: workspace.slug }] };
  /** Backend that lists `prs` for the workspace repo. */
  const serving = (...prs: PullRequest[]) => ({
    backend: { ...repos, connector_list_pull_requests: prs },
  });
  const linked = () => connectors.set([githubLinked]);
  const open = () => {
    linked();
    railTiles.set({ pr: true });
  };
</script>

{#snippet tile()}
  <!-- The rail's expanded width (ActivityRail.svelte). -->
  <div style="width: 300px">
    <PrTile workspacePath={workspace.path} branch={workspace.branch} now={Date.now()} />
  </div>
{/snippet}

<Story
  name="Failing checks, comments"
  parameters={serving(
    pull({ checks: checks.failing, review: { kind: "comments", count: 3 }, commentsCount: 3 }),
  )}
  beforeEach={linked}
  template={tile}
/>
<Story
  name="Checks running"
  parameters={serving(pull({ checks: checks.running }))}
  beforeEach={linked}
  template={tile}
/>
<Story
  name="Approved, all passed"
  parameters={serving(pull({ review: { kind: "approved" } }))}
  beforeEach={linked}
  template={tile}
/>
<Story
  name="Approved, expanded"
  parameters={serving(pull({ review: { kind: "approved" } }))}
  beforeEach={open}
  template={tile}
/>
<Story
  name="Changes requested, expanded"
  parameters={serving(pull({ checks: checks.failing, review: { kind: "changes" } }))}
  beforeEach={open}
  template={tile}
/>
<Story
  name="Draft"
  parameters={serving(pull({ state: "draft", checks: [] }))}
  beforeEach={linked}
  template={tile}
/>
<Story
  name="Merged"
  parameters={serving(pull({ state: "merged", review: { kind: "approved" } }))}
  beforeEach={linked}
  template={tile}
/>
<Story name="No PR yet" parameters={serving()} beforeEach={linked} template={tile} />
<Story
  name="Loading"
  parameters={{
    backend: { ...repos, connector_list_pull_requests: () => new Promise(() => {}) },
  }}
  beforeEach={linked}
  template={tile}
/>
<Story
  name="No connector"
  parameters={{ backend: repos }}
  beforeEach={() => connectors.set([githubNotLinked])}
  template={tile}
/>
<Story
  name="Sign-in expired"
  parameters={{ backend: repos }}
  beforeEach={() => connectors.set([githubExpired])}
  template={tile}
/>
<Story
  name="Rate limited"
  parameters={{
    backend: {
      ...repos,
      connector_list_pull_requests: () => {
        throw {
          kind: "connectorRateLimited",
          message: "rate limited",
          retryAt: Math.floor(Date.now() / 1000) + 900,
        };
      },
    },
  }}
  beforeEach={linked}
  template={tile}
/>
<Story
  name="Couldn't load"
  parameters={{
    backend: {
      ...repos,
      connector_list_pull_requests: () => {
        throw { kind: "timeout", message: "request timed out" };
      },
    },
  }}
  beforeEach={open}
  template={tile}
/>
