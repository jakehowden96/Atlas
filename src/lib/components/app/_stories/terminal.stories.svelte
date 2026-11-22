<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import TerminalTab from "../terminal/TerminalTab.svelte";
  import TerminalContainer from "../terminal/TerminalContainer.svelte";
  import { BILLING, FOCUSED, seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Terminal",
    parameters: { layout: "fullscreen", backend: worldBackend },
  });

  const tab = `tab-${FOCUSED}`;
  const noop = () => {};
  const session = () => seedWorld("session");
</script>

<!-- The PTY replays the fixture transcript (worldBackend `pty_spawn`). -->
<Story name="Tab" beforeEach={session}>
  {#snippet template()}
    <div style="height: 100vh; display: flex">
      <TerminalTab tabId={tab} visible ready cwd={BILLING} harnessLabel="Claude Code" onPtyReady={noop} onSpawnError={noop} />
    </div>
  {/snippet}
</Story>

<Story name="Tab, spawn failed" beforeEach={session}>
  {#snippet template()}
    <div style="height: 100vh; display: flex">
      <TerminalTab tabId={tab} visible spawnError="claude: command not found" harnessLabel="Claude Code" onPtyReady={noop} onSpawnError={noop} />
    </div>
  {/snippet}
</Story>

<Story name="Container" beforeEach={session}>
  {#snippet template()}<div style="height: 100vh; display: flex"><TerminalContainer visibleTabId={tab} /></div>{/snippet}
</Story>
