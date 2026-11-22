<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import TopBar from "../shell/TopBar.svelte";
  import StatusChips from "../shell/StatusChips.svelte";
  import SetupBanners from "../shell/SetupBanners.svelte";
  import NotificationsPanel from "../shell/NotificationsPanel.svelte";
  import FirstRun from "../shell/FirstRun.svelte";
  import ClaudeMissing from "../shell/ClaudeMissing.svelte";
  import DropTarget from "../shell/DropTarget.svelte";
  import ErrorBoundary from "../shell/ErrorBoundary.svelte";
  import { claudeHookStale } from "$lib/stores/claude";
  import { firstRunDismissed } from "$lib/stores/settings";
  import { notificationLog } from "$lib/stores/toast";
  import { seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Shell",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const min = 60_000;
  const notifications = () =>
    notificationLog.set([
      { id: "n1", title: "pinned-tiles needs you", body: "Allow Bash: pnpm vitest run overview?", type: "warning", time: Date.now() - 2 * min, read: false },
      { id: "n2", title: "overview-sort hit an error", body: "Tests failed: 2 of 48", type: "error", time: Date.now() - 9 * min, read: false },
      { id: "n3", title: "docs-refresh finished", type: "success", time: Date.now() - 40 * min, read: true },
    ]);
  const boom = (): string => {
    throw new Error("Cannot read properties of undefined (reading 'slice')");
  };
</script>

<Story name="Top bar" parameters={{ layout: "fullscreen" }} beforeEach={() => (seedWorld("sessions"), notifications())}>
  {#snippet template()}<TopBar />{/snippet}
</Story>

<Story name="Top bar, no sessions" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<TopBar />{/snippet}
</Story>

<Story name="Status chips" beforeEach={() => seedWorld("sessions")}>
  {#snippet template()}<StatusChips />{/snippet}
</Story>

<Story name="Setup banners" parameters={{ layout: "fullscreen" }} beforeEach={() => claudeHookStale.set(true)}>
  {#snippet template()}<SetupBanners />{/snippet}
</Story>

<Story name="Notifications" beforeEach={notifications}>
  {#snippet template()}<div style="width: 360px"><NotificationsPanel /></div>{/snippet}
</Story>

<Story name="Notifications, empty">
  {#snippet template()}<div style="width: 360px"><NotificationsPanel /></div>{/snippet}
</Story>

<Story name="First run" parameters={{ layout: "fullscreen" }} beforeEach={() => firstRunDismissed.set(false)}>
  {#snippet template()}<FirstRun />{/snippet}
</Story>

<Story name="Claude missing, panel" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<ClaudeMissing />{/snippet}
</Story>

<Story name="Claude missing, banner" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<ClaudeMissing variant="banner" />{/snippet}
</Story>

<Story name="Drop target" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}<div style="position: relative; height: 100vh"><DropTarget state={{ kind: "over", folders: 1, files: 2 }} /></div>{/snippet}
</Story>

<Story name="Error boundary" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}
    <div style="height: 100vh; display: flex">
      <ErrorBoundary name="Stats"><p>{boom()}</p></ErrorBoundary>
    </div>
  {/snippet}
</Story>
