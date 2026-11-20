<script lang="ts">
  import { tooltip } from "../../ui/tooltip";
  import { chord, enterLabel } from "../../platform";
  /**
   * The command-style New Session modal: pick a workspace on the left, then
   * start a New conversation, Resume a prior one, or work on an open PR from
   * the right.
   *
   * The keyboard model and the workspace filter live in `../../new-session.ts`
   * so they can be unit-tested without a Svelte compiler; this file is the
   * rendering and the side effects.
   */
  import { get } from "svelte/store";
  import type { Pr } from "../../../types/generated/Pr";
  import type { ResumableSession } from "../../../types/generated/ResumableSession";
  import { homeDir } from "@tauri-apps/api/path";
  import { listResumableSessions, validateDirectory } from "../../ipc";
  import { log } from "../../logger";
  import {
    ageLabel,
    clampState,
    filterWorkspaces,
    expandHome,
    findWorkspace,
    handleKey,
    harnessIndexFor,
    INITIAL_STATE,
    KEY_HINTS,
    leaveResumeIfUnsupported,
    looksLikeAbsolutePath,
    normalizePath,
    recencyOf,
    setMode,
    type NewSessionCounts,
    type NewSessionMode,
    type NewSessionState,
  } from "../../new-session";
  import {
    addWorkspaceFolder,
    removeWorkspaceWithUndo,
    spawnHarnessSession,
    workOnPr,
  } from "../../session-actions";
  import { claudeMissing } from "../../stores/claude";
  import { prRepos, prSetupProblem, reposByWorkspace } from "../../stores/prs";
  import {
    harnesses,
    lastHarnessId,
    setLastHarnessId,
    openSettings,
    type HarnessConfig,
  } from "../../stores/settings";
  import { showToast } from "../../stores/toast";
  import { focusedSessionId, newSessionOpen, newSessionSeed, showView } from "../../stores/view";
  import { addWorkspace, visibleWorkspaces, type Workspace } from "../../stores/workspace";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "../ui/icon/icon.svelte";
  import TooltipButton from "$lib/components/app/common/TooltipButton.svelte";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Item from "$lib/components/ui/item/index.js";
  import { activateOnKey } from "../../ui/activate";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { closeWith } from "../../ui/delay";
  import * as RadioGroup from "$lib/components/ui/radio-group/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import Segmented, { type Segment } from "$lib/components/app/common/Segmented.svelte";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { errorMessage } from "../../ipc-error";

  let query = $state("");
  let nav = $state<NewSessionState>({ ...INITIAL_STATE });
  let resumable = $state<ResumableSession[]>([]);
  let loadingResume = $state(false);
  /** The last Resume lookup failed, distinct from a workspace with no history. */
  let resumeError = $state("");
  /** Bumped by Retry so the lookup effect runs again for the same workspace. */
  let retryTick = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let wsColEl = $state<HTMLDivElement | null>(null);
  let resumePaneEl = $state<HTMLDivElement | null>(null);
  let prPaneEl = $state<HTMLDivElement | null>(null);
  /** A file the caller wants the session to start on, shown under the input. */
  let attached = $state("");
  /** Frozen at open, the ages in the list would otherwise re-render constantly. */
  let now = $state(new Date());

  let filtered = $derived(filterWorkspaces($visibleWorkspaces, query));
  /** A typed or pasted path that is not a workspace yet, the add row offers it. */
  let addPath = $derived(
    looksLikeAbsolutePath(query) && !findWorkspace($visibleWorkspaces, query.trim())
      ? query.trim()
      : "",
  );
  /**
   * "Add workspace…" is an action, not a selection, so the highlight landing on it
   * leaves the workspace picked. Deliberately derived from `nav` and `filtered`
   * alone and never from `resumable`, the effect below writes `resumable`, and
   * reading it back here would make that effect feed itself.
   */
  let selected = $derived<Workspace | null>(
    filtered.length === 0
      ? null
      : (filtered[Math.min(Math.max(0, nav.wsIndex), filtered.length - 1)] ?? null),
  );

  /** Open PRs of the repos the selected workspace holds, with the repo each is in. */
  let prItems = $derived.by(() => {
    const slugs = new Set(
      (selected ? ($reposByWorkspace[selected.path] ?? []) : []).flatMap((r) =>
        r.slug ? [r.slug.toLowerCase()] : [],
      ),
    );
    return ($prRepos ?? []).flatMap((entry) =>
      slugs.has(entry.repo.toLowerCase()) ? entry.prs.map((pr) => ({ repo: entry.repo, pr })) : [],
    );
  });
  let prsLoading = $derived($prRepos === null && !$prSetupProblem);

  let counts = $derived<NewSessionCounts>({
    workspaces: filtered.length,
    resumable: resumable.length,
    prs: prItems.length,
    harnesses: $harnesses.length,
  });
  /** `nav` with indices pulled back in range after the lists changed under it. */
  let view = $derived(clampState(nav, counts));
  /** The harness the session will launch, driven by the arrow keys. */
  let selectedHarness = $derived<HarnessConfig | null>($harnesses[view.harnessIndex] ?? null);
  let pickedResume = $derived<ResumableSession | null>(
    view.mode === "resume" ? (resumable[view.resumeIndex] ?? null) : null,
  );
  let pickedPr = $derived(view.mode === "pr" ? (prItems[view.prIndex] ?? null) : null);
  let canStart = $derived(
    selected !== null && (view.mode === "fresh" || pickedResume !== null || pickedPr !== null),
  );
  let startLabel = $derived(
    view.mode === "resume"
      ? "Resume session"
      : view.mode === "pr"
        ? `Work on #${pickedPr?.pr.number ?? "…"}`
        : "Start session",
  );

  // The id stays "fresh", `NewSessionSeed` and the Stats view read it. Only the
  // label the user sees changed.
  let modeOptions = $derived<Segment<NewSessionMode>[]>([
    { id: "fresh", label: "New" },
    {
      id: "resume",
      label: "Resume",
      count: resumable.length,
      disabled: !(selectedHarness?.resumable ?? false),
    },
    { id: "pr", label: "From PR", count: prItems.length },
  ]);

  // Plain `let`s, not `$state`, they gate effects and must not re-trigger them.
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
  // post-open `tick()` because the input is mounted by the Dialog, one flush later.
  $effect(() => {
    if ($newSessionOpen) inputEl?.focus();
  });

  // Keep the highlighted row on screen when ↑/↓ walks past the visible window.
  // Queried out of the column rather than held in a ref array so a filtered list
  // cannot leave stale entries behind; both columns render in document order.
  $effect(() => {
    const row =
      view.column === "resume"
        ? resumePaneEl?.querySelectorAll('[role="radio"]')[view.resumeIndex]
        : view.column === "pr"
          ? prPaneEl?.querySelectorAll('[role="option"]')[view.prIndex]
          : wsColEl?.querySelectorAll('[role="option"]')[view.wsIndex];
    row?.scrollIntoView({ block: "nearest" });
  });

  // The Resume list follows the selected workspace, but only exists for a
  // harness that can be resumed, Terminal has nothing to list, so
  // this never calls the IPC for them.
  $effect(() => {
    void retryTick;
    const resumableHarness = selectedHarness?.resumable ?? false;
    const path = $newSessionOpen && resumableHarness ? (selected?.path ?? "") : "";
    if (path === loadedFor) return;
    loadedFor = path;
    resumable = [];
    resumeError = "";
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
      .catch((e) => {
        log.warn("session", `listResumableSessions failed for ${path}: ${errorMessage(e)}`);
        if (loadedFor === path) resumeError = errorMessage(e);
      })
      .finally(() => {
        if (loadedFor === path) loadingResume = false;
      });
  });

  function retryResume() {
    loadedFor = "";
    retryTick++;
  }

  function applySeed() {
    const seed = get(newSessionSeed);
    query = "";
    let wantsResume = !!seed?.workspacePath && !!seed.resumeSessionId;
    let harnessIndex = harnessIndexFor(get(harnesses), get(lastHarnessId), wantsResume);
    if (harnessIndex < 0) {
      // Nothing configured can resume: open on New rather than an empty Resume pane.
      wantsResume = false;
      harnessIndex = harnessIndexFor(get(harnesses), get(lastHarnessId), false);
      showToast("No harness can resume sessions", {
        body: "Turn on Resumable for one in Settings → Harnesses.",
        type: "warning",
      });
    }
    nav = { ...INITIAL_STATE, harnessIndex };
    resumable = [];
    pendingResumeId = "";
    now = new Date();
    attached = seed?.attachPath ?? "";

    if (seed?.workspacePath) {
      const want = normalizePath(seed.workspacePath);
      const index = filterWorkspaces(get(visibleWorkspaces), "").findIndex(
        (w) => normalizePath(w.path) === want,
      );
      if (index >= 0) {
        nav = { ...nav, wsIndex: index, mode: wantsResume ? "resume" : "fresh" };
        pendingResumeId = wantsResume ? (seed.resumeSessionId ?? "") : "";
      } else {
        // Nothing owns that path, show it in the box so the add row offers it.
        query = seed.workspacePath;
      }
    }
  }

  function close() {
    newSessionOpen.set(false);
    // The Dialog owns the delayed unmount; clear the seed on the same beat so a
    // Stats-seeded Resume pick cannot leak into the next ⌘N.
    closeWith(() => newSessionSeed.set(null));
  }

  function chooseMode(id: NewSessionMode) {
    nav = setMode(view, id, counts);
  }

  function chooseHarness(id: string) {
    const harnessIndex = $harnesses.findIndex((h) => h.id === id);
    if (harnessIndex < 0) return;
    nav = leaveResumeIfUnsupported(
      { ...view, harnessIndex },
      $harnesses[harnessIndex]?.resumable ?? false,
    );
  }

  function pickWorkspace(index: number) {
    nav = { ...view, wsIndex: index, prIndex: 0, column: "workspaces" };
  }

  function pickResume(sessionId: string) {
    const resumeIndex = resumable.findIndex((r) => r.sessionId === sessionId);
    if (resumeIndex >= 0) nav = { ...view, mode: "resume", column: "resume", resumeIndex };
  }

  function pickPr(index: number) {
    nav = { ...view, mode: "pr", column: "pr", prIndex: index };
  }

  /** Move the highlight onto `path`, whichever position it sorted into. */
  function selectPath(path: string) {
    query = "";
    const want = normalizePath(path);
    const index = filterWorkspaces(get(visibleWorkspaces), "").findIndex(
      (w) => normalizePath(w.path) === want,
    );
    nav = { ...nav, wsIndex: Math.max(0, index), column: "workspaces" };
    inputEl?.focus();
  }

  async function addRow() {
    try {
      if (addPath) {
        const path = expandHome(addPath, await homeDir());
        // Rejects anything that is not an existing directory, so a typo never
        // becomes a workspace whose every session fails to spawn.
        await validateDirectory(path);
        await addWorkspace(path);
        selectPath(path);
        return;
      }
      const path = await addWorkspaceFolder();
      if (path) selectPath(path);
    } catch (e) {
      log.warn("session", `add workspace failed: ${errorMessage(e)}`);
      showToast("Could not add that folder", { body: errorMessage(e) });
    }
  }

  async function start() {
    const ws = selected;
    const harness = selectedHarness;
    if (!ws || !harness || !canStart) return;
    const pr = pickedPr;
    if (get(claudeMissing) && (pr || harness.id === "claude-code")) {
      showToast("Claude Code not found", {
        body: "Install it or choose its executable on the Sessions screen, then try again",
      });
      return;
    }
    const resumeSessionId = pickedResume?.sessionId;
    close();
    if (pr) {
      // Reports its own failures; the modal is already closed either way.
      await workOnPr(pr.repo, pr.pr);
      return;
    }
    void setLastHarnessId(harness.id);
    try {
      // Reattach the workspace row that already owns this conversation rather
      // than minting a second row for the same transcript.
      const existingSessionId = resumeSessionId
        ? ws.sessions.find((s) => s.claudeSessionId === resumeSessionId)?.id
        : undefined;
      const session = await spawnHarnessSession(ws.path, {
        harnessId: harness.id,
        ...(resumeSessionId ? { resumeSessionId, existingSessionId } : {}),
      });
      focusedSessionId.set(session.id);
      showView("session");
    } catch (e) {
      log.error("session", `failed to start a session in ${ws.path}`, e);
      showToast("Could not start a session", {
        body: `Nothing spawned in ${ws.name}. ${errorMessage(e)}`,
      });
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // A focused radio group or tab list steps itself with the arrow keys; the
    // modal's own arrow handling would move the highlight a second time.
    if (
      e.key.startsWith("Arrow") &&
      (e.target as HTMLElement).closest('[role="radiogroup"], [role="tablist"]')
    ) {
      return;
    }
    // With text in the filter box, bare ←/→ move its caret instead.
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && query !== "") return;
    const result = handleKey(e, nav, counts);
    if (!result.handled) return;
    e.preventDefault();
    // Escape and ⌘O are also global chords; the modal answers them first.
    e.stopPropagation();
    // The Resume UI depends on a resumable harness, Terminal has nothing to
    // resume, so neither Tab nor ←/→ may land in it for one.
    nav = leaveResumeIfUnsupported(
      result.state,
      $harnesses[result.state.harnessIndex]?.resumable ?? false,
    );
    if (result.effect === "close") close();
    else if (result.effect === "start") void start();
    else if (result.effect === "addFolder") void addRow();
  }

  function onInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value;
    nav = { ...nav, wsIndex: 0, prIndex: 0, column: "workspaces" };
  }

  function lastUsed(ws: Workspace): string {
    const t = recencyOf(ws);
    return t === 0 ? "never" : ageLabel(new Date(t).toISOString(), now);
  }

  /** A conversation that never earned an AI title still needs a handle. */
  function resumeTitle(row: ResumableSession): string {
    return row.title ?? `Session ${row.sessionId.slice(0, 8)}`;
  }

  function prMeta(pr: Pr): string {
    return `${pr.author.login} · ${pr.headRefName}`;
  }

  let resumeOptions = $derived(
    resumable.map((row) => ({
      value: row.sessionId,
      label: resumeTitle(row),
      description: `${ageLabel(row.lastTimestamp, now)} · ${row.userMessages} msgs · ${row.gitBranch ?? "no branch"}`,
    })),
  );
</script>

<!-- shadcn RadioGroup over {value, label, description?} options. -->
{#snippet radios(
  label: string,
  options: { value: string; label: string; description?: string }[],
  value: string,
  onPick: (v: string) => void,
)}
  <RadioGroup.Root aria-label={label} {value} onValueChange={onPick}>
    {#each options as o (o.value)}
      <Label class="items-start font-normal">
        <RadioGroup.Item value={o.value} class="mt-px" />
        <span class="grid gap-0.5">
          <span class="text-sm">{o.label}</span>
          {#if o.description}<span class="text-caption text-muted-foreground">{o.description}</span>{/if}
        </span>
      </Label>
    {/each}
  </RadioGroup.Root>
{/snippet}


<Dialog.Root open={$newSessionOpen} onOpenChange={(o) => { if (!o) close(); }}>
  <Dialog.Content class="w-[min(960px,calc(100vw-2rem))] top-[12vh] translate-y-0">
    <Dialog.Header><Dialog.Title>New session</Dialog.Title></Dialog.Header>
    <Dialog.Body>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="new-session" onkeydown={onKeydown}>
    <div class="bar">
      <span class="glyph"><Icon name="terminal" /></span>
      <input
        bind:this={inputEl}
        class="input"
        type="text"
        value={query}
        oninput={onInput}
        aria-label="Workspace or path"
        placeholder="Type a workspace name or a path"
        autocomplete="off"
        spellcheck="false"
      />
      <Kbd>esc</Kbd>
    </div>

    {#if attached}
      <div class="attached">
        With <span class="mono">{attached}</span> in mind
      </div>
    {/if}

    <div class="cols">
      <div class="ws-col" bind:this={wsColEl}>
        <div class="col-head" id="ns-ws-head">Workspaces · recent first</div>

        <div class="ws-list" role="listbox" aria-labelledby="ns-ws-head">
          {#each filtered as ws, i (ws.path)}
            <Item.Root role="option" aria-selected={view.column === "workspaces" && i === view.wsIndex} data-selected={view.column === "workspaces" && i === view.wsIndex} tabindex={0} onclick={() => pickWorkspace(i)} onkeydown={activateOnKey}>
              <span class="swatch" style="background: {ws.color ?? 'var(--success)'}"></span>
              <span class="ws-name">{ws.name}</span>
              <span class="ws-path" use:tooltip={{ text: ws.path }}>{ws.path}</span>
              <span class="ws-last">{lastUsed(ws)}</span>
              
            
<Item.Actions><TooltipButton
                  icon="close"
                  size="sm"
                  label="Remove {ws.name}"
                  tabindex={-1}
                  onclick={(e: MouseEvent) => {
                    e.stopPropagation();
                    void removeWorkspaceWithUndo(ws.path);
                  }}
                /></Item.Actions></Item.Root>
          {/each}

          <Item.Root role="option" aria-selected={view.column === "workspaces" && view.wsIndex === filtered.length} data-selected={view.column === "workspaces" && view.wsIndex === filtered.length} tabindex={0} onclick={addRow} onkeydown={activateOnKey}>
            <Icon name="add" />
            {#if addPath}
              <span class="add-label">Add <span class="add-path">{addPath}</span></span>
            {:else}
              <span class="add-label">Add workspace…</span>
            {/if}
            <span class="add-kbd">{chord("O")}</span>
          </Item.Root>
        </div>

        {#if filtered.length === 0 && !addPath}
          <p class="col-empty">
            {query.trim() ? `No workspace matches “${query.trim()}”` : "No workspaces yet"}
          </p>
        {/if}
      </div>

      <div class="right-col">
        <div>
          <div class="col-head mode-head">
            <span class="mode-title">
              Start in {selected?.name ?? "…"}
            </span>
            {#if counts.harnesses > 1}
              <span class="mode-hint"><Kbd>←→</Kbd> harness</span>
            {/if}
          </div>
          <div class="harness-pick">
            {@render radios(
              "Harness",
              $harnesses.map((h) => ({ value: h.id, label: h.label })),
              selectedHarness?.id ?? "",
              chooseHarness,
            )}
          </div>
        </div>

        <div>
          <div class="col-head mode-head">
            <span class="mode-title">Mode</span>
            <span class="mode-hint"><Kbd>tab</Kbd> switches</span>
          </div>
          <Segmented
            label="Mode"
            options={modeOptions}
            value={view.mode}
            onChange={chooseMode}
            fill
          />
        </div>

        <div
          class="panel"
          role="tabpanel"
          aria-label={modeOptions.find((o) => o.id === view.mode)?.label}
        >
          {#if view.mode === "resume"}
            <div class="resume-pane" bind:this={resumePaneEl}>
              <div class="resume-caption">
                From <span class="mono">claude --resume</span> · newest first
              </div>
              {#if loadingResume}
                <div class="skeletons" role="status" aria-label="Reading transcripts">
                  <Skeleton style="height: var(--h-xl)" class="rounded-lg" />
                  <Skeleton style="height: var(--h-xl)" class="rounded-lg" />
                  <Skeleton style="height: var(--h-xl)" class="rounded-lg" />
                </div>
              {:else if resumeError}
                <Alert.Root variant="destructive" layout="inline"><Icon name="error" /><Alert.Title>Could not read prior sessions: {resumeError}</Alert.Title></Alert.Root>
                <div><Button variant="outline" size="sm" onclick={retryResume}>Retry</Button></div>
              {:else if resumable.length === 0}
                <p class="empty">No prior sessions in this workspace yet, start a New one</p>
              {:else}
                {@render radios(
                  "Prior sessions",
                  resumeOptions,
                  pickedResume?.sessionId ?? "",
                  pickResume,
                )}
              {/if}
            </div>
          {:else if view.mode === "pr"}
            <div class="resume-pane" bind:this={prPaneEl}>
              <div class="resume-caption" id="ns-pr-head">
                Open pull requests in {selected?.name ?? "this workspace"}
              </div>
              {#if $prSetupProblem}
                <p class="empty">Link GitHub to list pull requests here</p>
                <div>
                  <Button variant="outline" size="sm" onclick={() => openSettings("connectors")}>
                    Open settings
                  </Button>
                </div>
              {:else if prsLoading}
                <div class="skeletons" role="status" aria-label="Loading pull requests">
                  <Skeleton style="height: var(--h-lg)" class="rounded-md" />
                  <Skeleton style="height: var(--h-lg)" class="rounded-md" />
                  <Skeleton style="height: var(--h-lg)" class="rounded-md" />
                </div>
              {:else if prItems.length === 0}
                <p class="empty">No open pull requests for this workspace</p>
              {:else}
                <div role="listbox" aria-labelledby="ns-pr-head">
                  {#each prItems as item, i (item.repo + "#" + item.pr.number)}
                    <Item.Root role="option" aria-selected={i === view.prIndex} data-selected={i === view.prIndex} tabindex={0} onclick={() => pickPr(i)} onkeydown={activateOnKey}>
                      <span class="pr-num">#{item.pr.number}</span>
                      <span class="ws-name">{item.pr.title}</span>
                      <span class="ws-last">{prMeta(item.pr)}</span>
                    </Item.Root>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <p class="fresh-copy">
              Opens a new {selectedHarness?.label ?? "session"} in
              <span class="mono strong">{selected?.path ?? "—"}</span> with Atlas hooks attached.
            </p>
          {/if}
        </div>

        <!-- Rendered from `KEY_HINTS` rather than written out here, so the
             footer cannot drift from what `handleKey` actually claims. -->
        <div class="hints">
          {#each KEY_HINTS as hint (hint.label)}
            {#if !hint.multiHarnessOnly || counts.harnesses > 1}
              <span><Kbd>{hint.keys}</Kbd> {hint.label}</span>
            {/if}
          {/each}
        </div>

        <Button variant="default" disabled={!canStart} onclick={start}>
          {startLabel}
          <Kbd>{enterLabel()}</Kbd>
        </Button>
      </div>
    </div>
  </div>
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  .new-session {
    display: flex;
    flex-direction: column;
    height: min(620px, calc(100vh - 100px));
  }

  /* ── Top bar ───────────────────────────────────────────────────────────── */
  .bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--sp-3);
    padding: var(--sp-4) 14px;
    border-bottom: 1px solid var(--border);
  }

  .attached {
    flex-shrink: 0;
    padding: 7px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glyph {
    display: inline-flex;
    color: var(--muted-foreground);
  }

  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  /* Replaces the outline above. The field is borderless because the bar is its
     frame, so focus tints the bar's rule rather than ringing the box. */
  .bar:has(.input:focus-visible) {
    border-bottom-color: var(--success);
  }

  .input::placeholder {
    color: var(--muted-foreground);
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
    gap: var(--sp-0);
    width: 372px;
    min-width: 0;
    padding: var(--sp-3);
    overflow: auto;
    border-right: 1px solid var(--border);
  }

  .ws-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-0);
  }

  .col-head {
    padding: var(--sp-2) var(--sp-3) var(--sp-1);
    color: var(--muted-foreground);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .col-empty {
    margin: var(--sp-1) var(--sp-3);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .swatch {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: var(--radius-xs);
  }

  .ws-name {
    flex-shrink: 0;
    max-width: 55%;
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-last {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .add-label {
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add-path {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  .add-kbd {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  /* ── Right column ──────────────────────────────────────────────────────── */
  .right-col {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: var(--sp-4);
    min-width: 0;
    padding: 14px;
    background: var(--background);
  }

  .right-col .col-head {
    padding: 0;
    margin-bottom: var(--sp-3);
  }

  .mode-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
  }

  /* The right column is the narrow one, 268px in New mode, so a workspace
     with a long name would otherwise push the tab hint out of the modal. */
  .mode-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Tab is the only way to reach the segmented control, so it is labelled where
     the control is rather than only in the footer hints. */
  .mode-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-normal);
    letter-spacing: 0;
    text-transform: none;
  }

  /* A handful of harnesses read better side by side than stacked. */
  .harness-pick :global(.group) {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--sp-3) var(--sp-5);
  }

  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .fresh-copy {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: 1.5;
  }

  /* An absolute path has no spaces to wrap at, so this one sentence would run
     off the end of the column and be cut. Break it anywhere instead. */
  .fresh-copy .mono {
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .strong {
    color: var(--foreground);
  }

  .resume-pane {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* Delayed so it lands after the panel mounts. */
    animation: atlasSlideIn 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) 0.08s both;
  }

  .resume-caption {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .empty {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  .skeletons {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .pr-num {
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  /* ── Footer ────────────────────────────────────────────────────────────── */
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-4);
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  .hints span {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
</style>
