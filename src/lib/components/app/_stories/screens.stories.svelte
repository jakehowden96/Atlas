<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import App from "../../../../App.svelte";
  import { seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  // Compare against docs/design-handoff/Screens - Shell and Sessions / Work Views.
  const { Story } = defineMeta({
    title: "Screens/App",
    parameters: { layout: "fullscreen", backend: worldBackend },
  });
</script>

{#snippet app()}
  <App />
{/snippet}

<Story name="Sessions" beforeEach={() => seedWorld("sessions")} template={app} />
<Story name="Session" beforeEach={() => seedWorld("session")} template={app} />
<Story name="Files" beforeEach={() => seedWorld("files")} template={app} />
<Story name="Pull requests" beforeEach={() => seedWorld("prs")} template={app} />
<Story name="Stats" beforeEach={() => seedWorld("stats")} template={app} />
