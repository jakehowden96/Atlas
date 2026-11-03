<script module lang="ts">
  /** Official install commands; update here when Anthropic's docs change. */
  export const INSTALL_COMMANDS = [
    { os: "macOS and Linux", command: "curl -fsSL https://claude.ai/install.sh | bash" },
    { os: "Windows PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
  ] as const;
</script>

<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { claudeCheck } from "../../ipc";
  import { errorMessage } from "../../ipc-error";
  import { recheckClaude } from "../../stores/claude";
  import { setClaudeBinaryPath, openSettings } from "../../stores/settings";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";

  interface Props {
    /** "panel" replaces the grid; "banner" sits over it. */
    variant?: "panel" | "banner";
  }

  let { variant = "panel" }: Props = $props();

  let pickError = $state("");

  async function choose() {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Choose the claude binary",
    });
    if (typeof picked !== "string") return;
    try {
      await claudeCheck(picked);
      pickError = "";
      // The store re-checks when the override changes.
      await setClaudeBinaryPath(picked);
    } catch (e) {
      pickError = `Not a working claude binary: ${errorMessage(e)}`;
    }
  }
</script>

{#snippet buttons()}
  <Button variant="primary" onclick={choose}>Choose executable…</Button>
  <Button onclick={recheckClaude}>Check again</Button>
  <Button variant="link" onclick={() => openSettings("claude")}>Open Claude Code settings</Button>
{/snippet}

{#if variant === "banner"}
  <div class="banner">
    <Banner tone="error" title="Claude Code not found">
      Sessions can't start until Atlas can run claude. {pickError}
      {#snippet actions()}{@render buttons()}{/snippet}
    </Banner>
  </div>
{:else}
  <div class="panel">
    <EmptyState
      icon="error"
      title="Claude Code not found"
      description="Atlas can't run claude, so sessions can't start. Install it, then check again"
    >
      {#snippet action()}
        <ul class="cmds">
          {#each INSTALL_COMMANDS as { os, command } (os)}
            <li>
              <span class="os">{os}</span>
              <code>{command}</code>
              <CopyButton value={command} label={`Copy ${os} command`} />
            </li>
          {/each}
        </ul>
        {#if pickError}<p class="err" role="alert">{pickError}</p>{/if}
        <div class="row">{@render buttons()}</div>
      {/snippet}
    </EmptyState>
  </div>
{/if}

<style>
  .panel {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
  }
  .banner {
    padding: var(--sp-3) var(--sp-5) 0;
  }
  .cmds {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    margin: 0 0 var(--sp-4);
    padding: 0;
    list-style: none;
    text-align: left;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .os {
    min-width: 9rem;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--sp-3);
  }
  .err {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
