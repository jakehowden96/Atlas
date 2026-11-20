<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import "./shared.css";
  import { claudeInfo, openUrl } from "../../../ipc";
  import { errorMessage } from "../../../ipc-error";
  import { log } from "../../../logger";
  import { revealInFileManager } from "../../../ui/reveal";
  import { autoCheckUpdates, setAutoCheckUpdates } from "../../../stores/settings";
  import { checkForUpdate, installUpdate, updateState } from "../../../updater";
  import Mark from "../../app/common/Mark.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { confirmAction } from "../../app/common/ConfirmDialog.svelte";
  import CopyButton from "../../app/common/CopyButton.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Progress } from "$lib/components/ui/progress/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";

  let { version }: { version: string } = $props();

  const REPO = "https://github.com/jakehowden96/Atlas";
  const LINKS = [
    { label: "Repository", url: REPO },
    { label: "Changelog", url: `${REPO}/blob/main/CHANGELOG.md` },
    { label: "Licence", url: `${REPO}/blob/main/LICENSE` },
  ];

  let claudeVersion = $state("unknown");
  let checking = $state(false);
  let installing = $state(false);
  let progress = $state<number | undefined>(undefined);

  $effect(() => {
    claudeInfo()
      .then((i) => (claudeVersion = i.version ?? "not found"))
      .catch((e) => log.warn("settings", `claude_info failed: ${errorMessage(e)}`));
  });

  const diagnostics = $derived(
    [
      `Atlas ${version}`,
      `OS: ${navigator.userAgent}`,
      `Claude Code: ${claudeVersion}`,
      `Updates: ${$updateState.kind}`,
    ].join("\n"),
  );

  async function check() {
    checking = true;
    try {
      await checkForUpdate();
    } finally {
      checking = false;
    }
  }

  async function install() {
    if ($updateState.kind !== "available") return;
    const ok = await confirmAction({
      title: `Update to ${$updateState.version}`,
      body: "Atlas will close and reopen to finish the update. Running sessions will end.",
      confirmLabel: "Update and relaunch",
    });
    if (!ok) return;
    installing = true;
    progress = undefined;
    await installUpdate((f) => (progress = f * 100));
    installing = false;
  }
</script>

<div class="stack sec">
  <div class="id">
    <Mark size={40} />
    <div>
      <div class="name">Atlas</div>
      <div class="meta">Version {version || "unknown"} · {import.meta.env.MODE} build</div>
    </div>
  </div>

  <div class="links">
    {#each LINKS as link (link.label)}
      <Button size="sm" variant="link" onclick={() => void openUrl(link.url)}>{link.label}</Button>
    {/each}
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Copy diagnostics</div>
      <div class="row-desc">Version, OS and Claude version for a bug report</div>
    </div>
    <CopyButton value={diagnostics} variant="text" size="sm" label="Copy diagnostics" />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Logs</div>
      <div class="row-desc">Open the log folder to attach to a bug report</div>
    </div>
    <Button variant="outline" size="sm" onclick={() => void revealInFileManager()}>Open logs</Button>
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Updates</div>
      <div class="row-desc" role="status">
        {#if $updateState.kind === "notConfigured"}
          Updates aren't configured in this build
        {:else if $updateState.kind === "upToDate"}
          Atlas is up to date
        {:else if $updateState.kind === "available"}
          Version {$updateState.version} is available
        {:else}
          Couldn't check for updates
        {/if}
      </div>
    </div>
    {#if $updateState.kind === "available"}
      <Button size="sm" variant="default" loading={installing} onclick={() => void install()}>
        Update to {$updateState.version}
      </Button>
    {:else if $updateState.kind !== "notConfigured"}
      <Button variant="outline" size="sm" loading={checking} onclick={() => void check()}>Check now</Button>
    {/if}
  </div>
  {#if installing}
    <Progress aria-label="Downloading update" value={progress} />
  {/if}
  {#if $updateState.kind === "error"}
    <Alert.Root variant="destructive" layout="inline"><Icon name="error" /><Alert.Title>{$updateState.message}</Alert.Title></Alert.Root>
  {/if}

  <div class="row">
    <div class="row-text">
      <div class="row-title">Check automatically</div>
      <div class="row-desc">Look for updates every hour</div>
    </div>
    <Switch checked={$autoCheckUpdates} onCheckedChange={(v) => void setAutoCheckUpdates(v)} aria-label="Check automatically" />
  </div>
</div>

<style>
  .id {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .name {
    font-family: var(--font-sans);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }

  .links {
    display: flex;
    gap: 8px;
  }
</style>
