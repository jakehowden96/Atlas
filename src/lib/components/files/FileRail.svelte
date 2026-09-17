<script lang="ts">
  /**
   * The Files screen's right-hand rail: the active document's outline, its
   * properties, the sessions editing it and the files it links to.
   *
   * Mounts and unmounts on `fileRailOpen` with the same delayed-unmount shape as
   * `session/ActivityRail.svelte`, so it slides in and out rather than blinking.
   */
  import type { SessionState } from "../../../types/session";
  import {
    absolutePath,
    parseFileKey,
    resolveWikilink,
    touchedBy,
    type FileTouch,
  } from "../../files";
  import { formatAgo, formatBytes } from "../../format";
  import { outline, wikilinks } from "../../markdown";
  import { buildTiles } from "../../overview";
  import {
    activeFile,
    diskDocs,
    docEntries,
    docs,
    fileWs,
    jumpToHeading,
    openFile,
    plans,
  } from "../../stores/files";
  import { liveSessionList } from "../../stores/liveSessions";
  import { sessionTouchedFiles } from "../../stores/panel";
  import { tabs } from "../../stores/terminal";
  import { fileRailOpen, focusedSessionId, showView } from "../../stores/view";
  import { sessionDiffStats, visibleWorkspaces } from "../../stores/workspace";
  import { closeWith } from "../ui/Modal.svelte";
  import StatePill, { type PillState } from "../ui/StatePill.svelte";

  const EXIT_MS = 200;
  const encoder = new TextEncoder();

  const PILL: Record<SessionState, PillState> = {
    running: "running",
    needsYou: "needs",
    idle: "idle",
    error: "error",
  };

  let visible = $state(false);
  let closing = $state(false);

  $effect(() => {
    if ($fileRailOpen) {
      visible = true;
      closing = false;
    } else if (visible && !closing) {
      closing = true;
      closeWith(() => {
        visible = false;
        closing = false;
      }, EXIT_MS);
    }
  });

  let key = $derived($activeFile);
  let file = $derived(parseFileKey(key));
  let text = $derived($docs.get(key) ?? $diskDocs.get(key) ?? "");
  let headings = $derived(key ? outline(text) : []);
  let files = $derived($docEntries.filter((e) => !e.is_dir));

  // Every wikilink in the document, paired with the doc it names — an
  // unresolved one is listed greyed rather than hidden, so a typo is visible.
  let links = $derived(
    key
      ? wikilinks(text).map((target) => ({ target, rel: resolveWikilink(target, files) }))
      : [],
  );

  let needsInputTabs = $derived(new Set($tabs.filter((t) => t.needsInput).map((t) => t.id)));
  let tiles = $derived(
    buildTiles($liveSessionList, $visibleWorkspaces, $sessionDiffStats, needsInputTabs),
  );
  let touches = $derived(
    key ? touchedBy(absolutePath(file.source, file.path), tiles, $sessionTouchedFiles) : [],
  );

  let modified = $derived.by(() => {
    if (!key) return "—";
    const stamp =
      file.source === "plans"
        ? $plans.find((p) => p.path === file.path)?.modified
        : $docEntries.find((e) => e.rel_path === file.path)?.modified;
    const at = stamp ? Date.parse(stamp) : Number.NaN;
    return Number.isNaN(at) ? "—" : formatAgo(at, Date.now());
  });

  // The size of what is on screen, unsaved edit included — the listing's own
  // byte count would go stale the moment the document is typed into.
  let size = $derived(key ? formatBytes(encoder.encode(text).length) : "—");

  /**
   * The git line. Plans live in `~/.claude/plans` and a disk file can be
   * anywhere, so neither is under a repo the Files screen knows about; a
   * workspace doc reports whatever a session has done to it.
   *
   * Sessions sharing a workspace share its working tree, so the first touch's
   * counts are the file's counts — summing them would count the same diff twice.
   */
  let git = $derived.by<{ text: string; warn: boolean }>(() => {
    if (!key) return { text: "—", warn: false };
    if (file.source === "plans") return { text: "not tracked", warn: false };
    if (file.source === "disk") return { text: "outside workspace", warn: false };
    const touch = touches[0];
    if (!touch) return { text: "clean", warn: false };
    return { text: `modified · +${touch.added} −${touch.removed}`, warn: true };
  });

  function focusSession(touch: FileTouch) {
    focusedSessionId.set(touch.sessionId);
    showView("session");
  }
</script>

{#if visible}
  <aside class="rail" class:closing>
    <section>
      <h3 class="label">Outline</h3>
      {#each headings as heading (heading.id)}
        <button
          type="button"
          class="row heading-row"
          style="padding-left: {8 + (heading.level - 1) * 12}px"
          onclick={() => jumpToHeading(heading)}
        >
          {heading.text}
        </button>
      {:else}
        <p class="none">No headings</p>
      {/each}
    </section>

    <section>
      <h3 class="label">Properties</h3>
      <dl class="props">
        <dt>Modified</dt>
        <dd>{modified}</dd>
        <dt>Size</dt>
        <dd>{size}</dd>
        <dt>Git status</dt>
        <dd class:warn={git.warn}>{git.text}</dd>
      </dl>
    </section>

    <section>
      <h3 class="label">Touched by</h3>
      {#each touches as touch (touch.sessionId)}
        <button type="button" class="card" onclick={() => focusSession(touch)}>
          <span class="card-head">
            <span class="card-name">{touch.label}</span>
            <StatePill state={PILL[touch.state]} />
          </span>
          <span class="delta">
            <span class="added">+{touch.added}</span>
            <span class="removed">−{touch.removed}</span>
          </span>
        </button>
      {:else}
        <p class="none">No session has this file open</p>
      {/each}
    </section>

    <section>
      <h3 class="label">Links</h3>
      {#each links as link (link.target)}
        {#if link.rel}
          <button
            type="button"
            class="row link"
            title={link.rel}
            onclick={() => openFile($fileWs, link.rel as string)}
          >
            {link.target}
          </button>
        {:else}
          <span class="row broken">{link.target}</span>
        {/if}
      {:else}
        <p class="none">No links</p>
      {/each}
    </section>
  </aside>
{/if}

<style>
  .rail {
    display: flex;
    flex: 0 0 240px;
    flex-direction: column;
    gap: 18px;
    width: 240px;
    padding: 16px 8px;
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--bg);
    animation: atlasSlideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .rail.closing {
    animation: atlasSlideOut 0.2s ease both;
  }

  section {
    display: flex;
    flex-direction: column;
  }

  .label {
    margin: 0 0 4px 8px;
    color: var(--muted);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .none {
    margin: 0 0 0 8px;
    color: var(--muted);
    font-size: var(--fs-xs);
  }

  .row {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border-radius: var(--r-sm);
    color: var(--text);
    font-size: var(--fs-sm);
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heading-row,
  .link {
    cursor: pointer;
  }

  .heading-row:hover,
  .link:hover {
    background: var(--surface2);
  }

  .link {
    color: var(--accent);
  }

  .broken {
    color: var(--muted);
  }

  /* ── Properties ────────────────────────────────────────────────────────── */
  .props {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 0;
    padding: 0 8px;
    font-size: var(--fs-xs);
  }

  .props dt {
    color: var(--muted);
  }

  .props dd {
    margin: 0;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .props dd.warn {
    color: var(--warn);
  }

  /* ── Touched by ────────────────────────────────────────────────────────── */
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-bottom: 6px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .card:hover {
    border-color: var(--border2);
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .card-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .delta {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .added {
    color: var(--accent);
  }

  .removed {
    margin-left: 6px;
    color: var(--danger);
  }
</style>
