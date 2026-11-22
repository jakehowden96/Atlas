<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { tick } from "svelte";
  import { log } from "../../../logger";
  import { searchSettings, type SectionId, type SettingEntry } from "../../../settings-search";
  import { settingsOpen, settingsSection } from "../../../stores/settings";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import SettingsNav, { NAV } from "./SettingsNav.svelte";
  import { errorMessage } from "../../../ipc-error";
  import About from "./sections/About.svelte";
  import ClaudeCode from "./sections/ClaudeCode.svelte";
  import General from "./sections/General.svelte";
  import Connectors from "./sections/Connectors.svelte";
  import Harnesses from "./sections/Harnesses.svelte";
  import Keyboard from "./sections/Keyboard.svelte";
  import PullRequests from "./sections/PullRequests.svelte";
  import Workspaces from "./sections/Workspaces.svelte";

  let section = $state<SectionId>("general");
  let appVersion = $state("");
  let query = $state("");
  let paneBody = $state<HTMLElement>();
  let searchBox = $state<HTMLElement>();

  let title = $derived(NAV.find((n) => n.id === section)?.label ?? "Settings");
  let results = $derived(searchSettings(query));

  $effect(() => {
    getVersion()
      .then((v) => (appVersion = v))
      .catch((e) => log.warn("settings", `could not read the app version: ${errorMessage(e)}`));
  });

  $effect(() => {
    if ($settingsOpen && $settingsSection) {
      section = $settingsSection;
      query = "";
      settingsSection.set(null);
    }
  });

  function close() {
    settingsOpen.set(false);
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (!$settingsOpen || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
    e.preventDefault();
    searchBox?.querySelector("input")?.focus();
  }

  async function jump(entry: SettingEntry) {
    section = entry.section;
    query = "";
    await tick();
    const titleEl = [...(paneBody?.querySelectorAll<HTMLElement>(".row-title") ?? [])].find(
      (el) => el.textContent?.trim() === entry.title,
    );
    const row = titleEl?.closest<HTMLElement>(".row");
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.classList.add("found");
    setTimeout(() => row.classList.remove("found"), 1600);
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Dialog.Root
  open={$settingsOpen}
  onOpenChange={(o) => {
    if (!o) close();
  }}
>
  <Dialog.Content class="w-[min(760px,calc(100vw-2rem))]" aria-label="Settings">
    <Dialog.Body>
      <div class="settings">
        <SettingsNav bind:section bind:query bind:searchBox version={appVersion} />

        <div class="pane">
          <div class="pane-head">
            {query ? "Search results" : title}
            <div class="pane-spacer"></div>
            <TooltipButton icon="close" size="sm" label="Close settings" onclick={close} />
          </div>

          <div class="pane-body" bind:this={paneBody}>
            {#if query}
              {#if results.length === 0}
                <p class="none">No settings match "{query}"</p>
              {:else}
                <ul class="results">
                  {#each results as r (r.section + r.title)}
                    <li>
                      <button type="button" class="result" onclick={() => void jump(r)}>
                        <span class="r-title">{r.title}</span>
                        <span class="r-desc">
                          {NAV.find((n) => n.id === r.section)?.label} · {r.description}
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            {:else if section === "general"}
              <General />
            {:else if section === "keyboard"}
              <Keyboard />
            {:else if section === "workspaces"}
              <Workspaces />
            {:else if section === "connectors"}
              <Connectors />
            {:else if section === "pullRequests"}
              <PullRequests />
            {:else if section === "claude"}
              <ClaudeCode />
            {:else if section === "about"}
              <About version={appVersion} />
            {:else}
              <Harnesses />
            {/if}
          </div>
        </div>
      </div>
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  .settings {
    display: flex;
    height: 520px;
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
    height: var(--h-bar);
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .pane-spacer {
    flex: 1;
  }

  .pane-body {
    flex: 1;
    padding: 18px;
    overflow: auto;
  }

  /* ── Search results ────────────────────────────────────────────────────── */
  .none {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .result {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--foreground);
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
  }

  .result:hover {
    background: var(--muted);
  }

  .r-title {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .r-desc {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }

  /* Added to a section's row by jump(); the section components own the rows. */
  :global(.pane-body .row.found) {
    outline: var(--focus-width) solid var(--ring);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-md);
  }

  @media (prefers-reduced-motion: no-preference) {
    :global(.pane-body .row.found) {
      transition: outline-color var(--dur-slow) var(--ease-out);
    }
  }
</style>
