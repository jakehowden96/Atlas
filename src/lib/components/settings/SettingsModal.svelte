<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { log } from "../../logger";
  import { settingsOpen } from "../../stores/settings";
  import Modal from "../ui/Modal.svelte";
  import { errorMessage } from "../../ipc-error";
  import ClaudeCode from "./sections/ClaudeCode.svelte";
  import General from "./sections/General.svelte";
  import Connectors from "./sections/Connectors.svelte";
  import Harnesses from "./sections/Harnesses.svelte";
  import Keyboard from "./sections/Keyboard.svelte";
  import Workspaces from "./sections/Workspaces.svelte";

  type Section = "general" | "keyboard" | "workspaces" | "connectors" | "claude" | "harnesses";

  const NAV: { id: Section; label: string }[] = [
    { id: "general", label: "General" },
    { id: "keyboard", label: "Keyboard" },
    { id: "workspaces", label: "Workspaces" },
    { id: "connectors", label: "Connectors" },
    { id: "claude", label: "Claude Code" },
    { id: "harnesses", label: "Harnesses" },
  ];

  let section = $state<Section>("general");
  let appVersion = $state("");

  let title = $derived(NAV.find((n) => n.id === section)?.label ?? "Settings");

  $effect(() => {
    getVersion()
      .then((v) => (appVersion = v))
      .catch((e) => log.warn("settings", `could not read the app version: ${errorMessage(e)}`));
  });

  function close() {
    settingsOpen.set(false);
  }
</script>

<Modal open={$settingsOpen} onClose={close} width="760px">
  <div class="settings">
    <nav class="nav">
      <div class="nav-title">Settings</div>
      {#each NAV as item (item.id)}
        <button
          type="button"
          class="nav-item"
          class:active={section === item.id}
          onclick={() => (section = item.id)}
        >
          {item.label}
        </button>
      {/each}
      <div class="nav-spacer"></div>
      <div class="version">Atlas {appVersion} · ~/.atlas</div>
    </nav>

    <div class="pane">
      <div class="pane-head">
        {title}
        <div class="pane-spacer"></div>
        <button type="button" class="close" onclick={close} aria-label="Close settings">✕</button>
      </div>

      <div class="pane-body">
        {#if section === "general"}
          <General />
        {:else if section === "keyboard"}
          <Keyboard />
        {:else if section === "workspaces"}
          <Workspaces />
        {:else if section === "connectors"}
          <Connectors />
        {:else if section === "claude"}
          <ClaudeCode />
        {:else}
          <Harnesses />
        {/if}
      </div>
    </div>
  </div>
</Modal>

<style>
  .settings {
    display: flex;
    height: 520px;
  }

  /* ── Left nav ──────────────────────────────────────────────────────────── */
  .nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
    width: 180px;
    padding: 14px 8px;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }

  .nav-title {
    padding: 0 10px 12px;
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .nav-item {
    padding: 7px 10px;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }

  .nav-item:hover {
    background: var(--surface2);
    color: var(--text);
  }

  .nav-item.active {
    background: var(--surface2);
    color: var(--text);
    font-weight: 500;
  }

  .nav-spacer {
    flex: 1;
  }

  .version {
    padding: 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--muted);
  }

  /* ── Right pane ────────────────────────────────────────────────────────── */
  .pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .pane-head {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: 44px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .pane-spacer {
    flex: 1;
  }

  .close {
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-md);
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface2);
    color: var(--text);
  }

  .pane-body {
    flex: 1;
    padding: 18px;
    overflow: auto;
  }
</style>
