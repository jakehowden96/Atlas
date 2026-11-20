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
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "../ui/icon/icon.svelte";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import * as Item from "$lib/components/ui/item/index.js";
  import { activateOnKey } from "../../ui/activate";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
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

<Dialog.Root open={$openDialogOpen} onOpenChange={(o) => { if (!o) (() => openDialogOpen.set(false))(); }}>
  <Dialog.Content class="w-[min(620px,calc(100vw-2rem))]">
    <Dialog.Header><Dialog.Title>Open file</Dialog.Title></Dialog.Header>
    <Dialog.Body>
  <div class="dialog">
    <div class="bar">
      <TooltipButton
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
        <Alert.Root variant="destructive" layout="inline"><Icon name="error" /><Alert.Title>{error}</Alert.Title></Alert.Root>
      {:else if loading}
        {#each [0, 1, 2, 3, 4] as n (n)}
          <div class="skel"><Skeleton style="width: {80 - n * 10}%" class="rounded-sm" /></div>
        {/each}
      {:else if entries.length === 0}
        <p class="message">This folder is empty</p>
      {:else}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="options" role="listbox" aria-label="Folder contents" onkeydown={onListKeydown}>
          {#each entries as entry (entry.path)}
            {@const blocked = !entry.is_dir && !entry.is_text}
            <Item.Root role="option" aria-selected={false} data-selected={false} aria-disabled={blocked || undefined} data-disabled={blocked || undefined} tabindex={blocked ? -1 : 0} onclick={() => pick(entry)} onkeydown={activateOnKey}>
              <Icon name={entry.is_dir ? "folder" : "article"} />
              {#if blocked}
                <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<span {...props} class="inline-flex min-w-0"><span class="name">{entry.name}</span></span>{/snippet}</Tooltip.Trigger><Tooltip.Content>Only Markdown and text files can be opened</Tooltip.Content></Tooltip.Root>
              {:else}
                <span class="name">{entry.name}</span>
              {/if}
            </Item.Root>
          {/each}
        </div>
      {/if}
      {#if truncated}
        <p class="message">This folder has more entries than are shown</p>
      {/if}
    </div>
  </div>
    </Dialog.Body>
    <Dialog.Footer><span class="note">Markdown &amp; text only</span>
    <Button variant="outline" onclick={addFolder}>Add folder to Files</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

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
    border-radius: var(--radius-xs);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    white-space: nowrap;
    cursor: pointer;
  }

  .crumb:hover {
    background: var(--muted);
    color: var(--foreground);
  }

  .crumb.leaf {
    color: var(--foreground);
  }

  .sep {
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
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
    color: var(--muted-foreground);
    font-size: var(--text-caption);
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
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
</style>
