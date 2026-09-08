<script lang="ts">
  /**
   * The command-style New Session modal: pick a workspace on the left, then
   * start a Fresh conversation or Resume a prior one on the right.
   *
   * The keyboard model and the workspace filter live in `../../new-session.ts`
   * so they can be unit-tested without a Svelte compiler; this file is the
   * rendering and the side effects.
   */
  import { get } from "svelte/store";
  import type { ResumableSession } from "../../../types/stats";
  import { listResumableSessions } from "../../ipc";
  import { log } from "../../logger";
  import {
    ageLabel,
    clampState,
    filterWorkspaces,
    findWorkspace,
    handleKey,
    INITIAL_STATE,
    looksLikeAbsolutePath,
    normalizePath,
    recencyOf,
    setMode,
    type NewSessionCounts,
    type NewSessionMode,
    type NewSessionState,
  } from "../../new-session";
  import { addWorkspaceFolder, spawnClaudeSession } from "../../session-actions";
  import { showToast } from "../../stores/toast";
  import {
    focusedSessionId,
    newSessionOpen,
    newSessionSeed,
    showView,
  } from "../../stores/view";
  import { addWorkspace, workspaces, type Workspace } from "../../stores/workspace";
  import Modal, { closeWith } from "../ui/Modal.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";

  let query = $state("");
  let nav = $state<NewSessionState>({ ...INITIAL_STATE });
  let resumable = $state<ResumableSession[]>([]);
  let loadingResume = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  /** Frozen at open — the ages in the list would otherwise re-render constantly. */
  let now = $state(new Date());

  let filtered = $derived(filterWorkspaces($workspaces, query));
  /** A typed or pasted path that is not a workspace yet — the add row offers it. */
  let addPath = $derived(
    looksLikeAbsolutePath(query) && !findWorkspace($workspaces, query.trim())
      ? query.trim()
      : "",
  );
  let counts = $derived<NewSessionCounts>({
    workspaces: filtered.length,
    resumable: resumable.length,
  });
  /** `nav` with indices pulled back in range after the lists changed under it. */
  let view = $derived(clampState(nav, counts));
  /**
   * "Add folder…" is an action, not a selection, so the highlight landing on it
   * leaves the workspace picked. Deliberately derived from `nav` and `filtered`
   * alone and never from `resumable` — the effect below writes `resumable`, and
   * reading it back here would make that effect feed itself.
   */
  let selected = $derived<Workspace | null>(
    filtered.length === 0
      ? null
      : (filtered[Math.min(Math.max(0, nav.wsIndex), filtered.length - 1)] ?? null),
  );
  let pickedResume = $derived<ResumableSession | null>(
    view.mode === "resume" ? (resumable[view.resumeIndex] ?? null) : null,
  );
  let canStart = $derived(
    selected !== null && (view.mode === "fresh" || pickedResume !== null),
  );

  let modeOptions = $derived<Segment[]>([
    { id: "fresh", label: "Fresh" },
    { id: "resume", label: "Resume", count: resumable.length },
  ]);

  // Plain `let`s, not `$state` — they gate effects and must not re-trigger them.
  let wasOpen = false;
  let loadedFor = "";
  let pendingResumeId = "";

  // Reset on each open, and apply whatever the caller aimed the modal at.
  $effect(() => {
    const open = $newSessionOpen;
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) applySeed();
  });

  // Focus the command input as soon as it exists. An effect rather than a
  // post-open `tick()` because the input is mounted by `Modal`, one flush later.
  $effect(() => {
    if ($newSessionOpen) inputEl?.focus();
  });

  // The Resume list follows the selected workspace.
  $effect(() => {
    const path = $newSessionOpen ? (selected?.path ?? "") : "";
    if (path === loadedFor) return;
    loadedFor = path;
    resumable = [];
    if (!path) return;
    loadingResume = true;
    listResumableSessions(path)
      .then((rows) => {
        if (loadedFor !== path) return;
        resumable = rows;
        if (!pendingResumeId) return;
        const index = rows.findIndex((r) => r.sessionId === pendingResumeId);
        pendingResumeId = "";
        if (index >= 0) nav = { ...nav, mode: "resume", column: "resume", resumeIndex: index };
      })
      .catch((e) => log.warn("session", `listResumableSessions failed for ${path}: ${e}`))
      .finally(() => {
        if (loadedFor === path) loadingResume = false;
      });
  });

  function applySeed() {
    const seed = get(newSessionSeed);
    query = "";
    nav = { ...INITIAL_STATE };
    resumable = [];
    pendingResumeId = "";
    now = new Date();

    if (seed?.workspacePath) {
      const want = normalizePath(seed.workspacePath);
      const index = filterWorkspaces(get(workspaces), "").findIndex(
        (w) => normalizePath(w.path) === want,
      );
      if (index >= 0) {
        nav = { ...nav, wsIndex: index, mode: seed.resumeSessionId ? "resume" : "fresh" };
        pendingResumeId = seed.resumeSessionId ?? "";
      } else {
        // Nothing owns that path — show it in the box so the add row offers it.
        query = seed.workspacePath;
      }
    }
  }

  function close() {
    newSessionOpen.set(false);
    // `Modal` owns the delayed unmount; clear the seed on the same beat so a
    // Stats-seeded Resume pick cannot leak into the next ⌘N.
    closeWith(() => newSessionSeed.set(null));
  }

  function chooseMode(id: string) {
    nav = setMode(view, id as NewSessionMode, counts);
  }

  function pickWorkspace(index: number) {
    nav = { ...view, wsIndex: index, column: "workspaces" };
  }

  function pickResume(index: number) {
    nav = { ...view, mode: "resume", column: "resume", resumeIndex: index };
  }

  /** Move the highlight onto `path`, whichever position it sorted into. */
  function selectPath(path: string) {
    query = "";
    const want = normalizePath(path);
    const index = filterWorkspaces(get(workspaces), "").findIndex(
      (w) => normalizePath(w.path) === want,
    );
    nav = { ...nav, wsIndex: Math.max(0, index), column: "workspaces" };
    inputEl?.focus();
  }

  async function addRow() {
    try {
      if (addPath) {
        await addWorkspace(addPath);
        selectPath(addPath);
        return;
      }
      const path = await addWorkspaceFolder();
      if (path) selectPath(path);
    } catch (e) {
      log.warn("session", `add workspace failed: ${e}`);
      showToast("Could not add that folder");
    }
  }

  async function start() {
    const ws = selected;
    if (!ws || !canStart) return;
    const resumeSessionId = pickedResume?.sessionId;
    close();
    showToast(`Starting in ${ws.name}`, { type: "info" });
    try {
      // Reattach the workspace row that already owns this conversation rather
      // than minting a second row for the same transcript.
      const existingSessionId = resumeSessionId
        ? ws.sessions.find((s) => s.claudeSessionId === resumeSessionId)?.id
        : undefined;
      const session = await spawnClaudeSession(
        ws.path,
        resumeSessionId ? { resumeSessionId, existingSessionId } : undefined,
      );
      focusedSessionId.set(session.id);
      showView("session");
    } catch (e) {
      log.error("session", `failed to start a session in ${ws.path}`, e);
      showToast("Could not start a session", { body: `Nothing spawned in ${ws.name}.` });
    }
  }

  function onKeydown(e: KeyboardEvent) {
    const result = handleKey(e, nav, counts);
    if (!result.handled) return;
    e.preventDefault();
    // Escape and ⌘O are also global chords; the modal answers them first.
    e.stopPropagation();
    nav = result.state;
    if (result.effect === "close") close();
    else if (result.effect === "start") void start();
    else if (result.effect === "addFolder") void addRow();
  }

  function onInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value;
    nav = { ...nav, wsIndex: 0, column: "workspaces" };
  }

  function lastUsed(ws: Workspace): string {
    const t = recencyOf(ws);
    return t === 0 ? "never" : ageLabel(new Date(t).toISOString(), now);
  }

  /** A conversation that never earned an AI title still needs a handle. */
  function resumeTitle(row: ResumableSession): string {
    return row.title ?? `Session ${row.sessionId.slice(0, 8)}`;
  }
</script>

<Modal
  open={$newSessionOpen}
  onClose={close}
  align="top"
  width={view.mode === "resume" ? "860px" : "640px"}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="new-session" onkeydown={onKeydown}>
    <div class="bar">
      <span class="glyph">›_</span>
      <input
        bind:this={inputEl}
        class="input"
        type="text"
        value={query}
        oninput={onInput}
        placeholder="New session — type a workspace, a path, or paste a PR link…"
        autocomplete="off"
        spellcheck="false"
      />
      <span class="kbd">esc</span>
    </div>

    <div class="cols">
      <div class="ws-col">
        <div class="col-head">Workspaces · recent first</div>

        {#each filtered as ws, i (ws.path)}
          <button
            type="button"
            class="ws-row"
            class:selected={view.column === "workspaces" && i === view.wsIndex}
            onclick={() => pickWorkspace(i)}
          >
            <span class="swatch" style="background: {ws.color ?? 'var(--accent)'}"></span>
            <span class="ws-text">
              <span class="ws-name">{ws.name}</span>
              <span class="ws-path" title={ws.path}>{ws.path}</span>
            </span>
            <span class="ws-last">{lastUsed(ws)}</span>
          </button>
        {/each}

        {#if filtered.length === 0 && !addPath}
          <p class="col-empty">
            {query.trim() ? `No workspace matches “${query.trim()}”.` : "No workspaces yet."}
          </p>
        {/if}

        <button
          type="button"
          class="add-row"
          class:selected={view.column === "workspaces" && view.wsIndex === filtered.length}
          onclick={addRow}
        >
          <span class="add-box"></span>
          {#if addPath}
            <span class="add-label">Add <span class="add-path">{addPath}</span></span>
          {:else}
            <span class="add-label">Add folder…</span>
          {/if}
          <span class="add-kbd">⌘O</span>
        </button>
      </div>

      <div class="right-col">
        <div>
          <div class="col-head">
            Start in {selected?.name ?? "…"}
          </div>
          <SegmentedControl
            options={modeOptions}
            value={view.mode}
            onChange={chooseMode}
            fill
          />
        </div>

        {#if view.mode === "resume"}
          <div class="resume-pane">
            <div class="resume-caption">
              From <span class="mono">claude --resume</span> · newest first
            </div>
            {#if loadingResume}
              <p class="resume-empty">Reading transcripts…</p>
            {:else if resumable.length === 0}
              <p class="resume-empty">
                No prior sessions in this workspace yet — start a Fresh one.
              </p>
            {:else}
              {#each resumable as row, i (row.sessionId)}
                <button
                  type="button"
                  class="resume-row"
                  class:selected={i === view.resumeIndex}
                  onclick={() => pickResume(i)}
                >
                  <span class="radio" class:on={i === view.resumeIndex}></span>
                  <span class="resume-text">
                    <span class="resume-title">{resumeTitle(row)}</span>
                    <span class="resume-meta">
                      {ageLabel(row.lastTimestamp, now)} · {row.userMessages} msgs · {row.gitBranch ??
                        "no branch"}
                    </span>
                  </span>
                </button>
              {/each}
            {/if}
          </div>
        {:else}
          <p class="fresh-copy">
            Opens a new Claude Code session in <span class="mono strong"
              >{selected?.path ?? "—"}</span
            > with Atlas hooks attached.
          </p>
        {/if}

        <div class="grow"></div>

        <button type="button" class="start" disabled={!canStart} onclick={start}>
          {view.mode === "resume" ? "Resume session" : "Start session"}
          <span class="start-kbd">⏎</span>
        </button>
      </div>
    </div>
  </div>
</Modal>

<style>
  .new-session {
    display: flex;
    flex-direction: column;
    height: 420px;
  }

  /* ── Top bar ───────────────────────────────────────────────────────────── */
  .bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .glyph {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }

  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13.5px;
  }

  .input::placeholder {
    color: var(--muted);
  }

  .kbd {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-xs);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .cols {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* ── Workspace column ──────────────────────────────────────────────────── */
  .ws-col {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 2px;
    width: 372px;
    min-width: 0;
    padding: 8px;
    overflow: auto;
    border-right: 1px solid var(--border);
  }

  .col-head {
    padding: 6px 8px 4px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .col-empty {
    margin: 4px 8px;
    color: var(--muted);
    font-size: 11.5px;
  }

  .ws-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    padding: 8px 10px;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  .ws-row:hover {
    background: var(--surface2);
  }

  .ws-row.selected {
    background: var(--surface2);
    box-shadow: inset 0 0 0 1px var(--border2);
  }

  .swatch {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: var(--r-xs);
  }

  .ws-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .ws-name {
    font-size: 12.5px;
    font-weight: 500;
  }

  .ws-path {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-last {
    flex-shrink: 0;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    margin-top: 4px;
    padding: 9px 10px;
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .add-row:hover,
  .add-row.selected {
    color: var(--text);
  }

  .add-row.selected {
    background: var(--surface2);
  }

  .add-box {
    display: block;
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border: 1.5px dashed var(--border2);
    border-radius: var(--r-xs);
  }

  .add-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add-path {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .add-kbd {
    margin-left: auto;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  /* ── Right column ──────────────────────────────────────────────────────── */
  .right-col {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 12px;
    min-width: 0;
    padding: 14px;
    background: var(--bg);
  }

  .right-col .col-head {
    padding: 0;
    margin-bottom: 8px;
  }

  .grow {
    flex: 1;
  }

  .fresh-copy {
    margin: 0;
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.5;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .strong {
    color: var(--text);
  }

  .resume-pane {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    overflow: auto;
    /* Delayed so it lands after the 640→860px width transition has started. */
    animation: atlasSlideIn 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) 0.08s both;
  }

  .resume-caption {
    color: var(--muted);
    font-size: 11px;
  }

  .resume-empty {
    margin: 0;
    color: var(--muted);
    font-size: 11.5px;
  }

  .resume-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  .resume-row:hover {
    border-color: var(--border2);
  }

  .resume-row.selected {
    border-color: var(--text);
  }

  .radio {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border: 1px solid var(--border2);
    border-radius: 50%;
  }

  .radio.on {
    border-color: var(--text);
  }

  .radio.on::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text);
  }

  .resume-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .resume-title {
    overflow: hidden;
    font-size: 12px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .resume-meta {
    margin-top: 2px;
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Footer ────────────────────────────────────────────────────────────── */
  .start {
    flex-shrink: 0;
    height: 32px;
    border: none;
    border-radius: var(--r-lg);
    background: var(--ink);
    color: var(--ink-text);
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .start:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .start-kbd {
    margin-left: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.6;
  }
</style>
