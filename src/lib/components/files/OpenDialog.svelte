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
  import type { DirEntry } from "../../../types/generated/DirEntry";
  import { breadcrumbs, parentDir } from "../../files";
  import { filesGrant, listDir } from "../../ipc";
  import { log } from "../../logger";
  import { showToast } from "../../stores/toast";
  import { addSource, fileWs, openFile } from "../../stores/files";
  import { openDialogOpen } from "../../stores/view";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import InlineAlert from "../ui/InlineAlert.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Modal from "../ui/Modal.svelte";
  import Skeleton from "../ui/Skeleton.svelte";
  import Tooltip from "../ui/Tooltip.svelte";
  import { errorMessage } from "../../ipc-error";

  let dir = $state("");
  let entries = $state<DirEntry[]>([]);
  let truncated = $state(false);
  let error = $state("");
  let loading = $state(false);

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

  /**
   * Walk to `target`, or open where the shown workspace is when there is
   * nowhere yet.
   *
   * The workspace comes first because home is not a useful root on Windows: a
   * drive is the top of its own tree, so a dialog that starts under
   * `C:\Users\…` can never walk to a workspace on `E:\`. Home is the fallback
   * for a Files screen with no workspace on it.
   */
  async function navigate(target: string | null) {
    const path = target ?? dir ?? "";
    loading = true;
    try {
      dir = path || $fileWs || (await homeDir());
      const listing = await listDir(dir);
      entries = listing.entries;
      truncated = listing.truncated;
      error = "";
    } catch (e) {
      log.error("files", `listDir failed for ${dir || path}`, e);
      entries = [];
      truncated = false;
      error = errorMessage(e);
    } finally {
      loading = false;
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

  /** Arrow keys walk the enabled options; Enter and Space are ListRow's. */
  function onListKeydown(e: KeyboardEvent) {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const rows = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled])',
      ),
    ];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[Math.min(rows.length - 1, Math.max(0, at + step))]?.focus();
  }

  /** The native folder picker: registering a folder needs no greyed rows. */
  async function addFolder() {
    try {
      const picked = await pickFolder({ directory: true, multiple: false, defaultPath: dir });
      if (typeof picked !== "string") return;
      // The native picker is what authorises the folder; the backend accepts
      // nothing outside workspaces and folders it was told about this way.
      await filesGrant(picked);
      await addSource(picked);
      openDialogOpen.set(false);
    } catch (e) {
      log.error("files", "add folder to Files failed", e);
      showToast("Could not add that folder", { body: errorMessage(e) });
    }
  }
</script>

<Modal
  open={$openDialogOpen}
  onClose={() => openDialogOpen.set(false)}
  title="Open file"
  width="620px"
>
  <div class="dialog">
    <div class="bar">
      <IconButton
        icon="arrow_upward"
        label="Up one folder"
        size="sm"
        disabled={!up}
        onclick={() => up && navigate(up)}
      />
      <nav class="crumbs" aria-label="Folder path">
        {#each crumbs as crumb, i (crumb.path)}
          {#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
          <button
            type="button"
            class="crumb"
            class:leaf={i === crumbs.length - 1}
            aria-current={i === crumbs.length - 1 ? "location" : undefined}
            onclick={() => navigate(crumb.path)}
          >
            {crumb.label}
          </button>
        {/each}
      </nav>
    </div>

    <div class="list">
      {#if error}
        <InlineAlert>{error}</InlineAlert>
      {:else if loading}
        {#each [0, 1, 2, 3, 4] as n (n)}
          <div class="skel"><Skeleton width="{80 - n * 10}%" /></div>
        {/each}
      {:else if entries.length === 0}
        <p class="message">This folder is empty</p>
      {:else}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="options" role="listbox" aria-label="Folder contents" onkeydown={onListKeydown}>
          {#each entries as entry (entry.path)}
            {@const blocked = !entry.is_dir && !entry.is_text}
            <ListRow option disabled={blocked} onclick={() => pick(entry)}>
              <Icon name={entry.is_dir ? "folder" : "article"} />
              {#if blocked}
                <Tooltip text="Only Markdown and text files can be opened">
                  <span class="name">{entry.name}</span>
                </Tooltip>
              {:else}
                <span class="name">{entry.name}</span>
              {/if}
            </ListRow>
          {/each}
        </div>
      {/if}
      {#if truncated}
        <p class="message">This folder has more entries than are shown</p>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <span class="note">Markdown &amp; text only</span>
    <Button onclick={addFolder}>Add folder to Files</Button>
  {/snippet}
</Modal>

<style>
  .dialog {
    display: flex;
    flex-direction: column;
    height: 400px;
  }

  .bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--border);
  }

  .crumbs {
    display: flex;
    align-items: center;
    flex: 1;
    gap: var(--sp-1);
    min-width: 0;
    overflow-x: auto;
  }

  .crumb {
    flex-shrink: 0;
    padding: 1px var(--sp-1);
    border-radius: var(--r-xs);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
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
    font-size: var(--fs-xs);
  }

  .list {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding: var(--sp-2);
    overflow-y: auto;
  }

  .options {
    display: flex;
    flex-direction: column;
  }

  .skel {
    display: flex;
    align-items: center;
    height: var(--h-lg);
    padding: 0 var(--sp-2);
  }

  .message {
    margin: var(--sp-2);
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    margin-right: auto;
    align-self: center;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
