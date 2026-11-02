<script lang="ts">
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
  import Toggle from "../../ui/Toggle.svelte";
  import { errorMessage } from "../../../ipc-error";

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
</script>

<div class="stack sec">
  <p class="copy">
    A workspace is a folder Claude runs in. Colour tags sessions everywhere; linking a GitHub repo
    lets you start sessions from its pull requests.
  </p>
  <div class="list">
    {#each $visibleWorkspaces as ws (ws.path)}
      <div class="list-row">
        <div class="swatches">
          {#each WORKSPACE_COLORS as colour (colour)}
            <button
              type="button"
              class="swatch"
              class:picked={ws.color === colour}
              style="background: {colour}"
              aria-label="Tag {ws.name} {colour}"
              onclick={() => void setWorkspaceColor(ws.path, colour)}
            ></button>
          {/each}
        </div>
        <div class="ws-text">
          <div class="ws-name">{ws.name}</div>
          <div class="ws-path">
            {ws.path}{$repoSlugsByWorkspace[ws.path] ? ` · ${$repoSlugsByWorkspace[ws.path]}` : ""}
          </div>
        </div>
        <span class="ws-count">{ws.sessions.length} sessions</span>
        <div
          class="lsp"
          title="Run a language server (TypeScript, Rust, …) for diagnostics in Files. A language server executes this workspace's own code, so it is off until you trust the workspace."
        >
          <span class="lsp-label">Language servers</span>
          <Toggle
            checked={$lspTrustedWorkspaces.includes(ws.path)}
            label="Language servers for {ws.name}"
            onChange={(v) => void setWorkspaceLsp(ws.path, v)}
          />
        </div>
        <button type="button" class="remove" onclick={() => void removeWorkspaceWithUndo(ws.path)}>
          Remove
        </button>
      </div>
    {/each}
    <button type="button" class="add-row" onclick={addFolder}>
      <span class="add-glyph"></span>
      Add workspace…
      <span class="add-hint">or drop a folder anywhere in Atlas</span>
    </button>
  </div>
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
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .swatch.picked {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3.5px var(--text);
  }

  .ws-text {
    flex: 1;
    min-width: 140px;
  }

  .ws-name {
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ws-path {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .lsp {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .lsp-label {
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
  }

  .ws-count {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
  }
</style>
