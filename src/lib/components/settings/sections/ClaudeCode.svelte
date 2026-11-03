<script lang="ts">
  import "./shared.css";
  import type { ClaudeInfo } from "../../../../types/generated/ClaudeInfo";
  import { claudeCheck, claudeInfo } from "../../../ipc";
  import { log } from "../../../logger";
  import { showToast } from "../../../stores/toast";
  import {
    claudeBinaryPath,
    claudeHook,
    setClaudeBinaryPath,
    setClaudeHookEnabled,
    setTailTranscripts,
    settingsOpen,
    tailTranscripts,
  } from "../../../stores/settings";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { HookStatus } from "../../../../types/generated/HookStatus";
  import Button from "../../ui/Button.svelte";
  import InlineAlert from "../../ui/InlineAlert.svelte";
  import StatusMark, { type MarkState } from "../../ui/StatusMark.svelte";
  import Toggle from "../../ui/Toggle.svelte";
  import { errorMessage } from "../../../ipc-error";

  let claude = $state<ClaudeInfo | null>(null);
  /** Set when `claude_info` itself failed, which is not the same as "not installed". */
  let claudeError = $state(false);

  /** Why the last picked binary was refused; the old choice stays saved. */
  let pickError = $state("");

  type Status = "ok" | "stale" | "missing";
  const MARK: Record<Status, MarkState> = { ok: "done", stale: "attention", missing: "failing" };
  const LABEL: Record<Status, string> = {
    ok: "Installed",
    stale: "Out of date",
    missing: "Not installed",
  };
  const hookStatus = (h: HookStatus | undefined): Status =>
    h?.kind === "installed" ? (h.upToDate ? "ok" : "stale") : "missing";

  const hooks = $derived([
    {
      name: "Notification",
      desc: "Flags a session waiting on a permission prompt",
      status: claude?.notificationHook,
    },
    {
      name: "SessionStart",
      desc: "Follows a session to its new id after /clear or /compact",
      status: claude?.sessionStartHook,
    },
  ]);

  async function choose() {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Choose the claude binary",
    });
    if (typeof picked !== "string") return;
    try {
      claude = await claudeCheck(picked);
      pickError = "";
      await setClaudeBinaryPath(picked);
    } catch (e) {
      log.warn("settings", `claude_check failed: ${errorMessage(e)}`);
      pickError = `Not a working claude binary: ${errorMessage(e)}`;
    }
  }

  async function useDefault() {
    pickError = "";
    await setClaudeBinaryPath("");
    try {
      claude = await claudeInfo();
    } catch (e) {
      log.warn("settings", `claude_info failed: ${errorMessage(e)}`);
    }
  }

  /** Install or remove the hooks, then refresh the installed badges from the
   *  file itself rather than assuming the change landed. */
  async function setHook(enabled: boolean) {
    try {
      await setClaudeHookEnabled(enabled);
    } catch (e) {
      log.warn(
        "settings",
        `could not ${enabled ? "install" : "remove"} the Claude hooks: ${errorMessage(e)}`,
      );
      showToast(
        enabled
          ? "Could not install the Claude Code hooks"
          : "Could not remove the Claude Code hooks",
        {
          body: errorMessage(e),
        },
      );
    }
    try {
      claude = await claudeInfo();
    } catch (e) {
      log.warn("settings", `claude_info failed: ${errorMessage(e)}`);
    }
  }

  // Fresh every open: the binary can be installed, and the hook written, while
  // Atlas is running.
  $effect(() => {
    if (!$settingsOpen) return;
    claudeError = false;
    claudeInfo()
      .then((info) => (claude = info))
      .catch((e) => {
        claudeError = true;
        log.warn("settings", `claude_info failed: ${errorMessage(e)}`);
      });
  });
</script>

<div class="stack sec">
  <div class="row">
    <div class="row-text">
      <div class="row-title">Install hooks</div>
      <div class="row-desc">Flags sessions that need you and follows /clear and /compact</div>
    </div>
    <Toggle checked={$claudeHook} label="Install hooks" onChange={(v) => void setHook(v)} />
  </div>

  <div class="list">
    {#each hooks as hook (hook.name)}
      {@const status = hookStatus(hook.status)}
      <div class="list-row hook-row">
        <StatusMark state={MARK[status]} />
        <span class="hook-name">{hook.name}</span>
        <span class="hook-desc">{hook.desc}</span>
        <span class="hook-status">{LABEL[status]}</span>
        {#if status === "stale"}
          <Button size="sm" onclick={() => void setHook(true)}>Update</Button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Tail transcripts</div>
      <div class="row-desc">Shows context, tokens, cost and subagents on each session</div>
    </div>
    <Toggle
      checked={$tailTranscripts}
      label="Tail transcripts"
      onChange={(v) => void setTailTranscripts(v)}
    />
  </div>

  <div class="row">
    <StatusMark state={claude?.binary ? "done" : "failing"} />
    <div class="row-text">
      <div class="row-title">Claude binary</div>
      <div class="row-desc binary">
        {#if claude?.binary}
          {claude.binary}{claude.version ? ` · ${claude.version}` : ""}
        {:else}
          {claudeError ? "Could not read claude" : "Not found"}
        {/if}
      </div>
    </div>
    {#if $claudeBinaryPath}
      <Button size="sm" variant="ghost" onclick={() => void useDefault()}>Use default</Button>
    {/if}
    <Button size="sm" onclick={() => void choose()}>Choose…</Button>
  </div>
  {#if pickError}
    <InlineAlert>{pickError}</InlineAlert>
  {/if}
</div>

<style>
  .hook-row {
    padding: 9px 12px;
  }

  .hook-name {
    width: 130px;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 500;
  }

  .hook-status {
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .binary {
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
  }

  .hook-desc {
    flex: 1;
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
