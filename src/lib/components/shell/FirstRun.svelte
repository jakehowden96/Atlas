<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import type { ClaudeInfo } from "../../../types/generated/ClaudeInfo";
  import { deriveFirstRun, type FirstRunItemId } from "../../first-run";
  import { claudeCheck, claudeInfo } from "../../ipc";
  import { errorMessage } from "../../ipc-error";
  import { log } from "../../logger";
  import { addWorkspaceFolder } from "../../session-actions";
  import {
    setClaudeBinaryPath,
    setClaudeHookEnabled,
    setFirstRunDismissed,
  } from "../../stores/settings";
  import { showToast } from "../../stores/toast";
  import { visibleWorkspaces } from "../../stores/workspace";
  import Mark from "../app/common/Mark.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "../ui/icon/icon.svelte";
  import StatusMark from "../app/common/StatusMark.svelte";

  let claude = $state<ClaudeInfo | null>(null);
  const checklist = $derived(deriveFirstRun(claude, $visibleWorkspaces.length));

  const ACTION: Record<FirstRunItemId, string> = {
    claude: "Choose Claude binary",
    hooks: "Install hooks",
    workspace: "Add workspace",
  };

  async function refresh() {
    try {
      claude = await claudeInfo();
    } catch (e) {
      log.warn("first-run", `claude_info failed: ${errorMessage(e)}`);
    }
  }

  async function chooseBinary() {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Choose the claude binary",
    });
    if (typeof picked !== "string") return;
    try {
      claude = await claudeCheck(picked);
      await setClaudeBinaryPath(picked);
    } catch (e) {
      showToast("Not a working claude binary", { body: errorMessage(e) });
    }
  }

  async function installHooks() {
    try {
      await setClaudeHookEnabled(true);
    } catch (e) {
      showToast("Could not install the Claude Code hooks", { body: errorMessage(e) });
    }
    await refresh();
  }

  const RUN: Record<FirstRunItemId, () => Promise<unknown>> = {
    claude: chooseBinary,
    hooks: installHooks,
    workspace: addWorkspaceFolder,
  };

  $effect(() => {
    void refresh();
  });

  // Finishing the last item dismisses the checklist for good.
  $effect(() => {
    if (checklist.allDone) void setFirstRunDismissed(true);
  });
</script>

<div class="first-run">
  <div class="col">
    <Mark size={40} />
    <h1 class="title">Welcome to Atlas</h1>
    <p class="copy">Three things to set up, then you can start your first session</p>

    <ul class="list">
      {#each checklist.items as item (item.id)}
        <li class="item">
          <StatusMark state={item.done ? "done" : "attention"} />
          <span class="label">{item.label}</span>
          <span class="word">{item.done ? "Done" : "To do"}</span>
          {#if !item.done}
            <Button variant="outline" size="sm" onclick={() => void RUN[item.id]()}>{ACTION[item.id]}</Button>
          {/if}
        </li>
      {/each}
    </ul>

    <button class="drop" type="button" onclick={() => void addWorkspaceFolder()}>
      <Icon name="folder" size={20} />
      Drop a folder here
    </button>

    <Button variant="link" onclick={() => void setFirstRunDismissed(true)}>Skip for now</Button>
  </div>
</div>

<style>
  .first-run {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-4);
    width: 460px;
    max-width: 100%;
    padding: var(--sp-7);
    text-align: center;
  }

  .title {
    margin: var(--sp-2) 0 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .copy {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    width: 100%;
    margin: var(--sp-3) 0 0;
    padding: 0;
    list-style: none;
    text-align: left;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    font-size: var(--text-sm);
  }

  .label {
    flex: 1;
  }

  .word {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .drop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-7) var(--sp-5);
    border: 2px dashed var(--input);
    border-radius: var(--radius-xl);
    background: transparent;
    color: var(--muted-foreground);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .drop:hover {
    border-color: var(--success);
    color: var(--foreground);
  }
</style>
