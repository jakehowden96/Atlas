<script lang="ts">
  import Icon from "$lib/components/ui/icon/icon.svelte";
  import "./shared.css";
  import { stopServersFor } from "../../../lsp-client";
  import { log } from "../../../logger";
  import { showToast } from "../../../stores/toast";
  import { addWorkspaceFolder, removeWorkspaceWithUndo } from "../../../session-actions";
  import { repoSlugsByWorkspace } from "../../../stores/prs";
  import { lspTrustedWorkspaces, setLspTrusted } from "../../../stores/settings";
  import {
    setWorkspaceColor,
    visibleWorkspaces,
    WORKSPACE_COLORS,
  } from "../../../stores/workspace";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { tooltip } from "../../../ui/tooltip";
  import { errorMessage } from "../../../ipc-error";
  import { revealInFileManager } from "../../../ui/reveal";

  /** Language servers run a workspace's own code, so they are opt-in per
   *  workspace; turning them off also stops any that are running. */
  async function setWorkspaceLsp(path: string, trusted: boolean) {
    try {
      await setLspTrusted(path, trusted);
      if (!trusted) await stopServersFor(path);
    } catch (e) {
      log.warn("settings", `could not change language servers for ${path}: ${errorMessage(e)}`);
      showToast("Could not change language servers", { body: errorMessage(e) });
    }
  }

  function addFolder() {
    addWorkspaceFolder().catch((e) => {
      log.error("settings", "add folder failed", e);
      showToast("Could not add that folder", { body: errorMessage(e) });
    });
  }

  /** Names for WORKSPACE_COLORS, same order, so each swatch has an accessible name. */
  const COLOUR_NAMES = [
    "green",
    "blue",
    "violet",
    "orange",
    "red",
    "grey",
    "lime",
    "amber",
    "cyan",
    "pink",
    "olive",
    "purple",
  ];
  const colourName = (c: string) => COLOUR_NAMES[WORKSPACE_COLORS.indexOf(c)] ?? c;

  /** Keep both ends of a path, which are the parts that identify it. */
  function midEllipsis(p: string, max = 56): string {
    if (p.length <= max) return p;
    const keep = max - 1;
    return `${p.slice(0, Math.ceil(keep / 2))}…${p.slice(p.length - Math.floor(keep / 2))}`;
  }

  function swatchKeys(e: KeyboardEvent, path: string) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const n = WORKSPACE_COLORS.length;
    const cur = WORKSPACE_COLORS.indexOf((e.target as HTMLElement).dataset.colour ?? "");
    const next = WORKSPACE_COLORS[(cur + step + n) % n]!;
    void setWorkspaceColor(path, next);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-colour="${next}"]`)?.focus();
  }
</script>

{#snippet addButton()}
  <Button variant="outline" onclick={addFolder}>Add workspace…</Button>
  <span class="add-hint">or drop a folder anywhere in Atlas</span>
{/snippet}

<div class="stack sec">
  <p class="copy">
    A workspace is a folder Claude runs in. The colour tags its sessions everywhere, and linking a
    GitHub repo lets you start sessions from its pull requests.
  </p>
  {#if $visibleWorkspaces.length === 0}
    <Empty.Root>
  <Empty.Header>
    <Empty.Media variant="icon"><Icon name="folder" size={20} /></Empty.Media>
    <Empty.Title>No workspaces yet</Empty.Title>
    <Empty.Description>Add a folder for Claude to run in</Empty.Description>
  </Empty.Header>
  <Empty.Content>{@render addButton()}</Empty.Content>
</Empty.Root>
  {:else}
    <div class="list">
      {#each $visibleWorkspaces as ws (ws.path)}
        <div class="list-row">
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div
            class="swatches"
            role="radiogroup"
            aria-label="Colour for {ws.name}"
            onkeydown={(e) => swatchKeys(e, ws.path)}
          >
            {#each WORKSPACE_COLORS as colour (colour)}
              <button
                type="button"
                class="swatch"
                class:picked={ws.color === colour}
                style="background: {colour}"
                role="radio"
                aria-checked={ws.color === colour}
                aria-label={colourName(colour)}
                data-colour={colour}
                tabindex={ws.color === colour || (!ws.color && colour === WORKSPACE_COLORS[0])
                  ? 0
                  : -1}
                onclick={() => void setWorkspaceColor(ws.path, colour)}
              ></button>
            {/each}
          </div>
          <div class="ws-text">
            <div class="ws-name">{ws.name}</div>
            <div class="ws-path" use:tooltip={{ text: ws.path }}>
              {midEllipsis(ws.path)}{$repoSlugsByWorkspace[ws.path]
                ? ` · ${$repoSlugsByWorkspace[ws.path]}`
                : ""}
            </div>
          </div>
          <span class="ws-count">{ws.sessions.length} sessions</span>
          <div class="lsp">
            <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<span {...props} class="inline-flex min-w-0"><span class="lsp-label">Language servers</span></span>{/snippet}</Tooltip.Trigger><Tooltip.Content>Runs a language server (TypeScript, Rust and others) for diagnostics in Files. It executes this workspace's own code, so it stays off until you trust the workspace</Tooltip.Content></Tooltip.Root>
            <Switch checked={$lspTrustedWorkspaces.includes(ws.path)} onCheckedChange={(v) => void setWorkspaceLsp(ws.path, v)} aria-label="Language servers for {ws.name}" />
            <span class="lsp-note">Runs this workspace's code</span>
          </div>
          <Button variant="outline" size="sm" onclick={() => void revealInFileManager(ws.path)}>Reveal</Button>
          <Button variant="destructive" size="sm" onclick={() => void removeWorkspaceWithUndo(ws.path)}>
            Remove
          </Button>
        </div>
      {/each}
      <div class="add-row">{@render addButton()}</div>
    </div>
  {/if}
</div>

<style>
  /* Two rows of six. Fixed tracks and no shrink, so a longer palette grows the
     row taller rather than squeezing the name and path beside it. */
  .swatches {
    display: grid;
    flex: none;
    grid-template-columns: repeat(6, 14px);
    gap: 4px;
  }

  .swatch {
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .swatch.picked {
    box-shadow:
      0 0 0 2px var(--card),
      0 0 0 3.5px var(--foreground);
  }

  .ws-text {
    flex: 1;
    min-width: 140px;
  }

  .ws-name {
    overflow: hidden;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ws-path {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .lsp {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .lsp-note {
    font-family: var(--font-sans);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    white-space: nowrap;
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--background);
  }

  .add-hint {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }

  .lsp-label {
    font-family: var(--font-sans);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    white-space: nowrap;
  }

  .ws-count {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    white-space: nowrap;
  }
</style>
