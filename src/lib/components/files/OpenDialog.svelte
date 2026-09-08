<script lang="ts">
  /**
   * ⌘O — browse the filesystem for a document to open.
   *
   * The in-app list is what the native picker cannot do: it shows every child of
   * the folder, greying out the ones the editor will not open, so a folder looks
   * like itself. Registering a whole folder has no such requirement, so that
   * button hands off to the platform's own folder picker.
   */
  import { open as pickFolder } from "@tauri-apps/plugin-dialog";
  import { homeDir } from "@tauri-apps/api/path";
  import type { DirEntry } from "../../../types/files";
  import { breadcrumbs, parentDir } from "../../files";
  import { listDir } from "../../ipc";
  import { log } from "../../logger";
  import { addSource, openFile } from "../../stores/files";
  import { openDialogOpen } from "../../stores/view";
  import Modal from "../ui/Modal.svelte";

  let dir = $state("");
  let entries = $state<DirEntry[]>([]);
  let error = $state("");

  let crumbs = $derived(dir ? breadcrumbs(dir) : []);
  let up = $derived(dir ? parentDir(dir) : null);

  // Reopening lands back where the last visit left off; the listing is re-read
  // so a folder that changed in between is not shown stale.
  let wasOpen = false;
  $effect(() => {
    const isOpen = $openDialogOpen;
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (isOpen) void navigate(null);
  });

  /** Walk to `target`, or to the home directory when there is nowhere yet. */
  async function navigate(target: string | null) {
    const path = target ?? dir ?? "";
    dir = path || (await homeDir());
    try {
      entries = await listDir(dir);
      error = "";
    } catch (e) {
      log.error("files", `listDir failed for ${dir}`, e);
      entries = [];
      error = String(e);
    }
  }

  function pick(entry: DirEntry) {
    if (entry.is_dir) {
      void navigate(entry.path);
      return;
    }
    if (!entry.is_text) return;
    openFile("disk", entry.path);
    openDialogOpen.set(false);
  }

  /** The native folder picker: registering a folder needs no greyed rows. */
  async function addFolder() {
    try {
      const picked = await pickFolder({ directory: true, multiple: false, defaultPath: dir });
      if (typeof picked !== "string") return;
      await addSource(picked);
      openDialogOpen.set(false);
    } catch (e) {
      log.error("files", "add folder to Files failed", e);
    }
  }
</script>

<Modal open={$openDialogOpen} onClose={() => openDialogOpen.set(false)} width="620px">
  <div class="dialog">
    <div class="bar">
      <button type="button" class="up" disabled={!up} onclick={() => up && navigate(up)}>↑</button>
      <div class="crumbs">
        {#each crumbs as crumb, i (crumb.path)}
          {#if i > 0}<span class="sep">/</span>{/if}
          <button
            type="button"
            class="crumb"
            class:leaf={i === crumbs.length - 1}
            onclick={() => navigate(crumb.path)}
          >
            {crumb.label}
          </button>
        {/each}
      </div>
      <span class="kbd">esc</span>
    </div>

    <div class="list">
      {#if error}
        <p class="message">{error}</p>
      {:else if entries.length === 0}
        <p class="message">This folder is empty.</p>
      {:else}
        {#each entries as entry (entry.path)}
          <button
            type="button"
            class="row"
            class:dim={!entry.is_dir && !entry.is_text}
            disabled={!entry.is_dir && !entry.is_text}
            title={entry.path}
            onclick={() => pick(entry)}
          >
            <span class="glyph">{entry.is_dir ? "▸" : "·"}</span>
            <span class="name">{entry.name}</span>
          </button>
        {/each}
      {/if}
    </div>

    <div class="foot">
      <span class="note">Markdown &amp; text only</span>
      <button type="button" class="add" onclick={addFolder}>Add folder to Files</button>
    </div>
  </div>
</Modal>

<style>
  .dialog {
    display: flex;
    flex-direction: column;
    height: 400px;
  }

  /* ── Breadcrumb ────────────────────────────────────────────────────────── */
  .bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .up {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }

  .up:hover:not(:disabled) {
    background: var(--surface2);
    color: var(--text);
  }

  .up:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .crumbs {
    display: flex;
    align-items: center;
    flex: 1;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
  }

  .crumb {
    flex-shrink: 0;
    padding: 1px 4px;
    border-radius: var(--r-xs);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
    white-space: nowrap;
    cursor: pointer;
  }

  .crumb:hover {
    background: var(--surface2);
    color: var(--text);
  }

  .crumb.leaf {
    color: var(--text);
  }

  .sep {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .kbd {
    flex-shrink: 0;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-xs);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  /* ── Listing ───────────────────────────────────────────────────────────── */
  .list {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding: 6px;
    overflow-y: auto;
  }

  .message {
    margin: 6px 8px;
    color: var(--muted);
    font-size: 11.5px;
  }

  .row {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--text);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .row:hover:not(:disabled) {
    background: var(--surface2);
  }

  /* Listed so the folder looks like itself, but nothing here can open it. */
  .row.dim {
    color: var(--muted);
    opacity: 0.55;
    cursor: default;
  }

  .glyph {
    flex-shrink: 0;
    width: 8px;
    color: var(--muted);
    font-size: 10px;
    text-align: center;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Footer ────────────────────────────────────────────────────────────── */
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .note {
    color: var(--muted);
    font-size: 11.5px;
  }

  .add {
    height: 26px;
    padding: 0 12px;
    border: none;
    border-radius: var(--r-md);
    background: var(--ink);
    color: var(--ink-text);
    font-family: var(--font-ui);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }
</style>
