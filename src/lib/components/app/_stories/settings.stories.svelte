<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import SettingsDialog from "../settings/SettingsDialog.svelte";
  import SettingsNav from "../settings/SettingsNav.svelte";
  import ShortcutSheet from "../settings/ShortcutSheet.svelte";
  import About from "../settings/sections/About.svelte";
  import ClaudeCode from "../settings/sections/ClaudeCode.svelte";
  import Connectors from "../settings/sections/Connectors.svelte";
  import General from "../settings/sections/General.svelte";
  import Harnesses from "../settings/sections/Harnesses.svelte";
  import Keyboard from "../settings/sections/Keyboard.svelte";
  import PullRequests from "../settings/sections/PullRequests.svelte";
  import Workspaces from "../settings/sections/Workspaces.svelte";
  import ApiKeyForm from "../settings/sections/connectors/ApiKeyForm.svelte";
  import BrowserSignInDialog from "../settings/sections/connectors/BrowserSignInDialog.svelte";
  import ConnectorRow from "../settings/sections/connectors/ConnectorRow.svelte";
  import DeviceCodeDialog from "../settings/sections/connectors/DeviceCodeDialog.svelte";
  import { settingsOpen, settingsSection, watchedRepos } from "$lib/stores/settings";
  import { shortcutsOpen } from "$lib/stores/view";
  import type { SectionId } from "$lib/settings-search";
  import type { Snippet } from "svelte";
  import { githubExpired, githubLinked, githubNotLinked } from "$lib/storybook/fixtures/prs";
  import { linearLinked, PRS, seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Settings",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const noop = () => {};
  const world = () => (seedWorld("sessions"), watchedRepos.set(Object.keys(PRS)));
  const open = (section: SectionId) => () => (world(), settingsSection.set(section), settingsOpen.set(true));
  const linear = linearLinked.info;
  const github = githubLinked.info;
</script>

{#snippet section(children: Snippet)}
  <div style="max-width: 640px">{@render children()}</div>
{/snippet}

<Story name="Dialog, general" parameters={{ layout: "fullscreen" }} beforeEach={open("general")}>
  {#snippet template()}<SettingsDialog />{/snippet}
</Story>
<Story name="Dialog, connectors" parameters={{ layout: "fullscreen" }} beforeEach={open("connectors")}>
  {#snippet template()}<SettingsDialog />{/snippet}
</Story>

<Story name="Nav">
  {#snippet template()}<div style="width: 220px"><SettingsNav section="connectors" query="" version="2.1.8" /></div>{/snippet}
</Story>
<Story name="Nav, searching">
  {#snippet template()}<div style="width: 220px"><SettingsNav section="general" query="theme" version="2.1.8" /></div>{/snippet}
</Story>

<Story name="General" beforeEach={world}>{#snippet template()}{#snippet c()}<General />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="Keyboard" beforeEach={world}>{#snippet template()}{#snippet c()}<Keyboard />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="Workspaces" beforeEach={world}>{#snippet template()}{#snippet c()}<Workspaces />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="Connectors" beforeEach={world}>{#snippet template()}{#snippet c()}<Connectors />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="Pull requests" beforeEach={world}>{#snippet template()}{#snippet c()}<PullRequests />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="Harnesses" beforeEach={world}>{#snippet template()}{#snippet c()}<Harnesses />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="Claude Code" beforeEach={world}>{#snippet template()}{#snippet c()}<ClaudeCode />{/snippet}{@render section(c)}{/snippet}</Story>
<Story name="About">{#snippet template()}{#snippet c()}<About version="2.1.8" />{/snippet}{@render section(c)}{/snippet}</Story>

<Story name="Connector rows">
  {#snippet template()}
    {#snippet c()}
      <ConnectorRow connector={githubLinked} onConnect={noop} onDisconnect={noop} />
      <ConnectorRow connector={githubExpired} onConnect={noop} onDisconnect={noop} />
      <ConnectorRow connector={githubNotLinked} onConnect={noop} onDisconnect={noop} />
      <ConnectorRow connector={linearLinked} onConnect={noop} onDisconnect={noop} />
    {/snippet}
    {@render section(c)}
  {/snippet}
</Story>

<Story name="API key form">{#snippet template()}{#snippet c()}<ApiKeyForm connector={linear} />{/snippet}{@render section(c)}{/snippet}</Story>

<Story name="Browser sign-in, waiting" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<BrowserSignInDialog connector={github} progress={{ kind: "waitingBrowser" }} onCancel={noop} onRetry={noop} />{/snippet}
</Story>
<Story name="Browser sign-in, failed" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<BrowserSignInDialog connector={github} progress={{ kind: "failed", reason: "github.com returned 503" }} onCancel={noop} onRetry={noop} />{/snippet}
</Story>
<Story name="Device code" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}
    <DeviceCodeDialog connector={github} progress={{ kind: "deviceCode", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 900_000 }} onCancel={noop} onRetry={noop} />
  {/snippet}
</Story>
<Story name="Device code, expired" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<DeviceCodeDialog connector={github} progress={{ kind: "expired" }} onCancel={noop} onRetry={noop} />{/snippet}
</Story>

<Story name="Shortcut sheet" parameters={{ layout: "fullscreen" }} beforeEach={() => shortcutsOpen.set(true)}>
  {#snippet template()}<ShortcutSheet />{/snippet}
</Story>
