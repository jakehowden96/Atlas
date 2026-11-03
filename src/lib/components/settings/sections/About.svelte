<script lang="ts">
  import "./shared.css";
  import { claudeInfo, openUrl } from "../../../ipc";
  import { errorMessage } from "../../../ipc-error";
  import { log } from "../../../logger";
  import { autoCheckUpdates, setAutoCheckUpdates } from "../../../stores/settings";
  import { checkForUpdate, installUpdate, updateState } from "../../../updater";
  import AtlasMark from "../../ui/AtlasMark.svelte";
  import Button from "../../ui/Button.svelte";
  import { confirmAction } from "../../ui/ConfirmDialog.svelte";
  import CopyButton from "../../ui/CopyButton.svelte";
  import InlineAlert from "../../ui/InlineAlert.svelte";
  import Progress from "../../ui/Progress.svelte";
  import Toggle from "../../ui/Toggle.svelte";

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
    <AtlasMark size={40} />
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
      <Button size="sm" variant="primary" loading={installing} onclick={() => void install()}>
        Update to {$updateState.version}
      </Button>
    {:else if $updateState.kind !== "notConfigured"}
      <Button size="sm" loading={checking} onclick={() => void check()}>Check now</Button>
    {/if}
  </div>
  {#if installing}
    <Progress label="Downloading update" value={progress} />
  {/if}
  {#if $updateState.kind === "error"}
    <InlineAlert>{$updateState.message}</InlineAlert>
  {/if}

  <div class="row">
    <div class="row-text">
      <div class="row-title">Check automatically</div>
      <div class="row-desc">Look for updates every hour</div>
    </div>
    <Toggle
      checked={$autoCheckUpdates}
      label="Check automatically"
      onChange={(v) => void setAutoCheckUpdates(v)}
    />
  </div>
</div>

<style>
  .id {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .name {
    font-family: var(--font-ui);
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .links {
    display: flex;
    gap: 8px;
  }
</style>
