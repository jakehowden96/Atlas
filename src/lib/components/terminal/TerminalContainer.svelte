<script lang="ts">
  import { chords } from "../../stores/settings";
  import { getSessionDir } from "../../ipc";
  import { tabs } from "../../stores/terminal";
  import { showToast } from "../../stores/toast";
  import TerminalTab from "./TerminalTab.svelte";

  interface Props {
    /**
     * The session terminal to show. Every other tab stays mounted with its
     * visibility toggled by CSS — remounting an xterm loses its scrollback and
     * detaches its PTY, so switching sessions must never unmount one.
     */
    visibleTabId: string;
  }

  let { visibleTabId }: Props = $props();

  async function handlePtyReady(tabId: string, ptyId: number) {
    tabs.update((t) => t.map((tab) => (tab.id === tabId ? { ...tab, ptyId } : tab)));
    try {
      await getSessionDir(tabId);
    } catch (e) {
      showToast("Failed to create session directory", { body: String(e) });
    }
  }
</script>

<div class="terminal-panes">
  {#each $tabs as tab (tab.id)}
    <TerminalTab
      tabId={tab.id}
      visible={tab.id === visibleTabId}
      ready={tab.ready !== false}
      cwd={tab.cwd}
      onData={tab.onData}
      onPtyReady={(ptyId) => handlePtyReady(tab.id, ptyId)}
    />
  {/each}
  {#if !$tabs.some((t) => t.id === visibleTabId)}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">terminal</span>
      <p class="empty-text">No session open — start one with {$chords.newSession}</p>
    </div>
  {/if}
</div>

<style>
  .terminal-panes {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--term-bg);
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    opacity: 0.5;
  }

  .empty-icon {
    font-size: 2.5rem !important;
    color: var(--muted);
  }

  .empty-text {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12.5px;
  }
</style>
