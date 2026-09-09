<script lang="ts">
  import { get } from "svelte/store";
  import { enterLabel } from "../../platform";
  import { claudeInfo, type ClaudeInfo } from "../../ipc";
  import {
    ACTION_LABELS,
    ACTIONS,
    DEFAULT_KEYMAP,
    findConflicts,
    formatBinding,
    formatChord,
    isReachable,
    parseBindingFromEvent,
    type Action,
    type Binding,
    type Keymap,
  } from "../../keymap";
  import { log } from "../../logger";
  import { addWorkspaceFolder, removeWorkspaceWithUndo } from "../../session-actions";
  import { prViewer, repoSlugsByWorkspace } from "../../stores/prs";
  import {
    autoAddReposFromWorkspaces,
    enableNotifications,
    keymap,
    MAX_TERMINAL_FONT_SIZE,
    MIN_TERMINAL_FONT_SIZE,
    overviewOrdering,
    prRefreshMinutes,
    resetKeymap,
    setAutoAddReposFromWorkspaces,
    setEnableNotifications,
    setKeymap,
    setOverviewOrdering,
    setPrRefreshMinutes,
    setSoundOnNeedsYou,
    setTailTranscripts,
    setTerminalFontSize,
    setTheme,
    setWatchedRepos,
    settingsOpen,
    soundOnNeedsYou,
    tailTranscripts,
    terminalFontSize,
    watchedRepos,
    type OverviewOrdering,
    type PrRefreshMinutes,
  } from "../../stores/settings";
  import { themeMode, type ThemeMode } from "../../theme";
  import { setWorkspaceColor, visibleWorkspaces, WORKSPACE_COLORS } from "../../stores/workspace";
  import Modal from "../ui/Modal.svelte";
  import SegmentedControl from "../ui/SegmentedControl.svelte";
  import Toggle from "../ui/Toggle.svelte";

  type Section = "general" | "keyboard" | "workspaces" | "prs" | "claude";

  const NAV: { id: Section; label: string }[] = [
    { id: "general", label: "General" },
    { id: "keyboard", label: "Keyboard" },
    { id: "workspaces", label: "Workspaces" },
    { id: "prs", label: "Pull requests" },
    { id: "claude", label: "Claude Code" },
  ];

  const APPEARANCE = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  const ORDERING = [
    { id: "attention", label: "Attention" },
    { id: "workspace", label: "Workspace" },
    { id: "manual", label: "Manual" },
  ];

  const REFRESH = [
    { id: "1", label: "1m" },
    { id: "3", label: "3m" },
    { id: "10", label: "10m" },
  ];

  let section = $state<Section>("general");
  let repoDraft = $state("");
  let claude = $state<ClaudeInfo | null>(null);
  /* The keymap is edited as a draft so a clash can be shown before it is
     saved. A conflicting draft is simply never persisted. */
  let draft = $state<Keymap>({ ...get(keymap) });
  /** Which chord slot is listening: index 0 is the action's primary, 1 its
   *  alternate. Null when nothing is being recorded. */
  let recording = $state<{ action: Action; index: number } | null>(null);

  let title = $derived(NAV.find((n) => n.id === section)?.label ?? "Settings");
  let conflicts = $derived(findConflicts(draft));

  // Fresh every open: the binary can be installed, and the hook written, while
  // Atlas is running.
  $effect(() => {
    if (!$settingsOpen) return;
    claudeInfo()
      .then((info) => (claude = info))
      .catch((e) => log.warn("settings", `claude_info failed: ${e}`));
  });

  // A fresh draft on every open, so an abandoned conflict does not linger.
  $effect(() => {
    if (!$settingsOpen) return;
    draft = { ...get(keymap) };
    recording = null;
  });

  function isRecording(action: Action, index: number): boolean {
    return recording?.action === action && recording.index === index;
  }

  /* Captured on the window in the capture phase, so the chord being recorded
     does not also fire its own action on the way past. */
  $effect(() => {
    if (recording === null) return;
    // Read out of the closure: `recording` is reassigned by the handler itself,
    // and TypeScript cannot narrow a mutable binding captured this way.
    const { action, index } = recording;
    function onKeydown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        recording = null;
        return;
      }
      const binding = parseBindingFromEvent(e);
      // Null is a bare modifier or a chord without ⌘/Ctrl — keep listening.
      if (!binding) return;
      const bindings = [...draft[action]];
      bindings[index] = binding;
      applyChords(action, bindings);
      recording = null;
    }
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  });

  function applyChords(action: Action, bindings: Binding[]) {
    const next = { ...draft, [action]: bindings };
    draft = next;
    // Refuse the save while two actions share a chord; both rows are marked.
    if (findConflicts(next).length > 0) return;
    void setKeymap(next);
  }

  /** Drop an action's alternate, leaving its primary alone. */
  function clearAlt(action: Action) {
    applyChords(action, [draft[action][0]]);
  }

  function resetAll() {
    draft = { ...DEFAULT_KEYMAP };
    recording = null;
    void resetKeymap();
  }

  function close() {
    settingsOpen.set(false);
  }

  function stepFont(delta: number) {
    void setTerminalFontSize($terminalFontSize + delta);
  }

  function addRepo() {
    const slug = repoDraft.trim();
    // `owner/repo` is what `gh` takes; anything else would just 404 per repo.
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug) || $watchedRepos.includes(slug)) return;
    void setWatchedRepos([...$watchedRepos, slug]);
    repoDraft = "";
  }

  function removeRepo(slug: string) {
    void setWatchedRepos($watchedRepos.filter((r) => r !== slug));
  }

  function onRepoKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addRepo();
  }
</script>

<Modal open={$settingsOpen} onClose={close} width="760px">
  <div class="settings">
    <nav class="nav">
      <div class="nav-title">Settings</div>
      {#each NAV as item (item.id)}
        <button
          type="button"
          class="nav-item"
          class:active={section === item.id}
          onclick={() => (section = item.id)}
        >
          {item.label}
        </button>
      {/each}
      <div class="nav-spacer"></div>
      <div class="version">Atlas 2.0.0 · ~/.atlas</div>
    </nav>

    <div class="pane">
      <div class="pane-head">
        {title}
        <div class="pane-spacer"></div>
        <button type="button" class="close" onclick={close} aria-label="Close settings">✕</button>
      </div>

      <div class="pane-body">
        {#if section === "general"}
          <div class="rows">
            <div class="row">
              <div class="row-text">
                <div class="row-title">Appearance</div>
                <div class="row-desc">Follows the OS unless you pin one.</div>
              </div>
              <SegmentedControl
                options={APPEARANCE}
                value={$themeMode}
                size="sm"
                onChange={(id) => void setTheme(id as ThemeMode)}
              />
            </div>

            <div class="row">
              <div class="row-text">
                <div class="row-title">System notifications</div>
                <div class="row-desc">
                  Notify when a session needs you and Atlas isn't focused.
                </div>
              </div>
              <Toggle
                checked={$enableNotifications}
                label="System notifications"
                onChange={(v) => void setEnableNotifications(v)}
              />
            </div>

            <div class="row">
              <div class="row-text">
                <div class="row-title">Sound on needs-you</div>
                <div class="row-desc">A short ping when a permission prompt appears.</div>
              </div>
              <Toggle
                checked={$soundOnNeedsYou}
                label="Sound on needs-you"
                onChange={(v) => void setSoundOnNeedsYou(v)}
              />
            </div>

            <div class="row">
              <div class="row-text">
                <div class="row-title">Terminal font size</div>
                <div class="row-desc">Geist Mono · applies to all sessions.</div>
              </div>
              <div class="stepper">
                <button
                  type="button"
                  onclick={() => stepFont(-0.5)}
                  disabled={$terminalFontSize <= MIN_TERMINAL_FONT_SIZE}
                  aria-label="Smaller terminal font"
                >−</button>
                <span class="stepper-value">{$terminalFontSize}</span>
                <button
                  type="button"
                  onclick={() => stepFont(0.5)}
                  disabled={$terminalFontSize >= MAX_TERMINAL_FONT_SIZE}
                  aria-label="Larger terminal font"
                >+</button>
              </div>
            </div>

            <div class="row">
              <div class="row-text">
                <div class="row-title">Sessions ordering</div>
                <div class="row-desc">Needs-you first, then running, then idle.</div>
              </div>
              <SegmentedControl
                options={ORDERING}
                value={$overviewOrdering}
                size="sm"
                onChange={(id) => void setOverviewOrdering(id as OverviewOrdering)}
              />
            </div>

          </div>
        {:else if section === "keyboard"}
          <div class="stack">
            <p class="copy">
              Every global chord. ⌘ and Ctrl are interchangeable, so one binding covers
              both platforms. Recording needs the modifier held; Esc cancels. An action
              can carry a second chord — some chords never reach the app, because the
              OS claims them first.
            </p>

            <div class="list">
              {#each ACTIONS as action (action)}
                <div class="list-row key-row" class:clash={conflicts.includes(action)}>
                  <span class="key-name">{ACTION_LABELS[action]}</span>
                  <span class="key-chords">
                    {#each draft[action] as binding, i (i)}
                      <span
                        class="mono-pill key-chord"
                        class:unreachable={!isReachable(binding)}
                        title={isReachable(binding)
                          ? undefined
                          : "This OS claims this chord — it never reaches Atlas."}
                      >{formatBinding(binding)}</span>
                    {/each}
                  </span>
                  <button
                    type="button"
                    class="key-btn"
                    class:recording={isRecording(action, 0)}
                    onclick={() =>
                      (recording = isRecording(action, 0) ? null : { action, index: 0 })}
                  >
                    {isRecording(action, 0) ? "Press a chord…" : "Record"}
                  </button>
                  {#if draft[action].length > 1}
                    <button type="button" class="key-btn" onclick={() => clearAlt(action)}>
                      Drop alt
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="key-btn"
                      class:recording={isRecording(action, 1)}
                      onclick={() =>
                        (recording = isRecording(action, 1) ? null : { action, index: 1 })}
                    >
                      {isRecording(action, 1) ? "Press a chord…" : "Add alt"}
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="key-btn"
                    onclick={() => applyChords(action, [...DEFAULT_KEYMAP[action]])}
                  >
                    Reset
                  </button>
                </div>
              {/each}
            </div>

            {#if conflicts.length > 0}
              <p class="copy bad">
                Two actions share a chord. Nothing is saved until one of the marked rows
                changes.
              </p>
            {/if}

            <div class="row">
              <div class="row-text">
                <div class="row-title">Reset all shortcuts</div>
                <div class="row-desc">Puts every chord back to its Atlas default.</div>
              </div>
              <button type="button" class="key-btn" onclick={resetAll}>Reset all</button>
            </div>

            <p class="copy">
              Esc on its own is not rebindable: inside a session it belongs to the Claude
              Code TUI, and everywhere else it closes whatever is open.
              <strong>{formatChord(draft.backToSessions)}</strong> is the way back to
              Sessions from a focused terminal.
            </p>
          </div>
        {:else if section === "workspaces"}
          <div class="stack">
            <p class="copy">
              A workspace is a folder Claude runs in. Colour tags sessions everywhere;
              linking a GitHub repo lets you start sessions from its pull requests.
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
                      {ws.path}{$repoSlugsByWorkspace[ws.path]
                        ? ` · ${$repoSlugsByWorkspace[ws.path]}`
                        : ""}
                    </div>
                  </div>
                  <span class="ws-count">{ws.sessions.length} sessions</span>
                  <button type="button" class="remove" onclick={() => void removeWorkspaceWithUndo(ws.path)}>
                    Remove
                  </button>
                </div>
              {/each}
              <button type="button" class="add-row" onclick={() => void addWorkspaceFolder()}>
                <span class="add-glyph"></span>
                Add workspace…
                <span class="add-hint">or drop a folder anywhere in Atlas</span>
              </button>
            </div>
          </div>
        {:else if section === "prs"}
          <div class="stack">
            <p class="copy">
              Repos listed on the Pull requests tab. Uses <code>gh</code>, which must be
              installed and signed in.
              {#if $prViewer}
                <span class="ok">gh auth status: ok · @{$prViewer.login}</span>
              {:else}
                <span class="bad">gh auth status: not authenticated</span>
              {/if}
            </p>

            <div class="chips">
              {#each $watchedRepos as repo (repo)}
                <span class="chip">
                  {repo}
                  <button
                    type="button"
                    class="chip-x"
                    aria-label="Stop watching {repo}"
                    onclick={() => removeRepo(repo)}
                  >✕</button>
                </span>
              {/each}
              <input
                class="chip-input"
                placeholder={`owner/repo ${enterLabel()}`}
                spellcheck="false"
                bind:value={repoDraft}
                onkeydown={onRepoKeydown}
              />
            </div>

            <div class="row">
              <div class="row-text">
                <div class="row-title">Auto-add repos from workspaces</div>
                <div class="row-desc">
                  Any workspace with a GitHub remote is watched automatically. Your own
                  entries above are kept separately, so turning this off leaves them alone.
                </div>
              </div>
              <Toggle
                checked={$autoAddReposFromWorkspaces}
                label="Auto-add repos from workspaces"
                onChange={(v) => void setAutoAddReposFromWorkspaces(v)}
              />
            </div>

            <div class="row">
              <div class="row-text"><div class="row-title">Refresh interval</div></div>
              <SegmentedControl
                options={REFRESH}
                value={String($prRefreshMinutes)}
                size="sm"
                onChange={(id) => void setPrRefreshMinutes(Number(id) as PrRefreshMinutes)}
              />
            </div>
          </div>
        {:else}
          <div class="stack">
            <p class="copy">
              Atlas reads Claude Code's own signals — no proxying. One hook is installed
              into <code>~/.claude/settings.json</code>; everything else comes from tailing
              the session transcript.
            </p>

            <div class="list">
              <div class="list-row hook-row">
                <span class="hook-dot" class:on={claude?.notificationHookInstalled}></span>
                <span class="hook-name">Notification</span>
                <span class="hook-desc">
                  Tells Atlas a session is waiting on a permission prompt.
                </span>
                <span class="badge" class:on={claude?.notificationHookInstalled}>
                  {claude?.notificationHookInstalled ? "installed" : "not installed"}
                </span>
              </div>
            </div>

            <p class="copy">
              Plan, subagents, tool calls and cost are <strong>not</strong> hooks. Atlas
              derives them by tailing <code>~/.claude/projects/**.jsonl</code>, which is
              why no Stop, PreToolUse, PostToolUse or Subagent hooks are installed.
            </p>

            <div class="row">
              <div class="row-text">
                <div class="row-title">Tail transcripts</div>
                <div class="row-desc">
                  Read <code>~/.claude/projects/**.jsonl</code> live for context %, tokens,
                  cost and subagents. Off stops every running tail; tiles fall back to
                  state and diff counts.
                </div>
              </div>
              <Toggle
                checked={$tailTranscripts}
                label="Tail transcripts"
                onChange={(v) => void setTailTranscripts(v)}
              />
            </div>

            <div class="row">
              <div class="row-text"><div class="row-title">Claude binary</div></div>
              <span class="mono-pill">
                {claude?.binary ?? "not found on PATH"}{claude?.version ? ` · ${claude.version}` : ""}
              </span>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</Modal>

<style>
  .settings {
    display: flex;
    height: 520px;
  }

  /* ── Left nav ──────────────────────────────────────────────────────────── */
  .nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
    width: 180px;
    padding: 14px 8px;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }

  .nav-title {
    padding: 0 10px 12px;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
  }

  .nav-item {
    padding: 7px 10px;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .nav-item:hover {
    background: var(--surface2);
    color: var(--text);
  }

  .nav-item.active {
    background: var(--surface2);
    color: var(--text);
    font-weight: 500;
  }

  .nav-spacer {
    flex: 1;
  }

  .version {
    padding: 0 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--muted);
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
    height: 44px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
  }

  .pane-spacer {
    flex: 1;
  }

  .close {
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 14px;
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface2);
    color: var(--text);
  }

  .pane-body {
    flex: 1;
    padding: 18px;
    overflow: auto;
  }

  /* ── Rows ──────────────────────────────────────────────────────────────── */
  .rows {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .row-text {
    flex: 1;
    min-width: 0;
  }

  .row-title {
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 500;
  }

  .row-desc {
    font-family: var(--font-ui);
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--muted);
  }

  code {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .copy {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }

  .ok {
    color: var(--accent);
  }

  .bad {
    color: var(--warn);
  }

  /* ── Font-size stepper ─────────────────────────────────────────────────── */
  .stepper {
    display: flex;
    align-items: center;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .stepper button {
    height: 100%;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .stepper button:hover:not(:disabled) {
    color: var(--text);
  }

  .stepper button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .stepper-value {
    padding: 0 6px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Bordered lists (workspaces, hooks) ────────────────────────────────── */
  .list {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 9px;
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .list-row:last-child {
    border-bottom: none;
  }

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
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ws-path {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ws-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }

  .remove {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .remove:hover {
    border-color: var(--danger);
    color: var(--danger);
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background: var(--bg);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .add-row:hover {
    color: var(--text);
  }

  .add-glyph {
    display: block;
    width: 10px;
    height: 10px;
    border: 1.5px dashed var(--border2);
    border-radius: var(--r-xs);
  }

  .add-hint {
    margin-left: 4px;
    font-size: 11px;
  }

  /* ── Keyboard ──────────────────────────────────────────────────────────── */
  .key-row {
    padding: 8px 12px;
  }

  .key-name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: 12.5px;
  }

  .key-chords {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
  }

  .key-chord {
    min-width: 74px;
    text-align: center;
  }

  /* Shown, because it is what is bound, but never promised: the OS takes this
     one before Atlas sees it. */
  .key-chord.unreachable {
    opacity: 0.5;
    text-decoration: line-through;
  }

  .key-row.clash .key-chord {
    border-color: var(--danger);
    color: var(--danger);
  }

  /* Shaped like .remove, but neither button here is destructive, so hover
     stays neutral rather than turning red. */
  .key-btn {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .key-btn:hover {
    border-color: var(--border2);
    color: var(--text);
  }

  .key-btn.recording {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ── Watched-repo chips ────────────────────────────────────────────────── */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--surface2);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .chip-x {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .chip-x:hover {
    color: var(--danger);
  }

  .chip-input {
    width: 140px;
    height: 26px;
    padding: 0 10px;
    border: 1px dashed var(--border2);
    border-radius: 13px;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 11.5px;
    outline: none;
  }

  /* Replaces the outline above: the dashed "add one" border goes solid accent
     while the box is being typed in. */
  .chip-input:focus-visible {
    border-style: solid;
    border-color: var(--accent);
  }

  /* ── Claude Code ───────────────────────────────────────────────────────── */
  .hook-row {
    padding: 9px 12px;
  }

  .hook-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--surface3);
  }

  .hook-dot.on {
    background: var(--accent);
  }

  .hook-name {
    width: 130px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
  }

  .hook-desc {
    flex: 1;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--muted);
  }

  .badge {
    padding: 2px 7px;
    border-radius: var(--r-sm);
    background: var(--surface2);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 10.5px;
    font-weight: 500;
  }

  .badge.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }

  .mono-pill {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
  }
</style>
