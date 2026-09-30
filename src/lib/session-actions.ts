/**
 * Terminal-session lifecycle, lifted out of `App.svelte`'s inline handlers.
 *
 * Everything here is a plain function over the stores, so the Mission Control
 * views (Sessions tiles, Session header, New Session modal, jump palette) can
 * all drive the same code paths without a component in the middle.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { get } from "svelte/store";
import { ptyKill, ptyWrite, startOmpTail, startSessionTail, stopSessionTail } from "./ipc";
import { log } from "./logger";
import { removeLiveSession } from "./stores/liveSessions";
import { showToast } from "./stores/toast";
import {
  DEFAULT_HARNESSES,
  harnesses,
  lastHarnessId,
  tailTranscripts,
  transcriptKind,
  type HarnessConfig,
} from "./stores/settings";
import { focusedSessionId, showView } from "./stores/view";
import {
  activeTabId,
  addTab,
  awaitTabPty,
  canAnswerPermission,
  permissionPromptTabs,
  removeTab,
  setTabNeedsInput,
  setTabReady,
  tabs,
} from "./stores/terminal";
import { basename } from "./format";
import { tabIdForSession } from "./session-view";
import {
  activeSessionId,
  activeWorkspacePath,
  addSession,
  addWorkspace,
  detachSession,
  hideWorkspace,
  rebindSessionClaudeId,
  resumeSession,
  stripBundleExtension,
  unhideWorkspace,
  updateSessionStatus,
  workspaces,
} from "./stores/workspace";

/** Guards against double-spawning while a session is still starting. */
const spawningSessionIds = new Set<string>();

/** Drop a session's transcript tail and its live state once its PTY is gone.
 *  The live entry goes after the tail has stopped: an update already computed
 *  when the stop was requested still lands first, and removing before it would
 *  let it re-insert a session nothing will ever remove. */
async function endSessionTail(claudeSessionId: string | null | undefined) {
  if (!claudeSessionId) return;
  try {
    await stopSessionTail(claudeSessionId);
  } catch (e) {
    log.warn("session", `stopSessionTail failed for ${claudeSessionId}: ${e}`);
  }
  removeLiveSession(claudeSessionId);
}

/** Kill a terminal tab's PTY, if it has one, and drop the tab. */
export async function closeSessionTab(tabId: string) {
  const tab = get(tabs).find((t) => t.id === tabId);
  if (tab && tab.ptyId >= 0) {
    try {
      await ptyKill(tab.ptyId);
    } catch (e) {
      log.warn("session", `ptyKill failed for tab ${tabId}: ${e}`);
    }
  }
  removeTab(tabId);
}

/**
 * Resolve a harness by id, falling back to Claude Code if the stored id no
 * longer exists (e.g. a custom harness deleted in Settings after a session
 * was created with it) — the one place a hardcoded id is allowed, purely as
 * a safety net.
 */
function resolveHarness(harnessId: string): HarnessConfig {
  const list = get(harnesses);
  return (
    list.find((h) => h.id === harnessId) ??
    list.find((h) => h.id === "claude-code") ??
    DEFAULT_HARNESSES[0]
  );
}

/** Substitute the `{sessionId}`/`{resumeId}` tokens with the Claude session
 *  UUID for this spawn. */
function resolveArgs(args: string[], claudeSessionId: string): string[] {
  return args.map((a) => (a === "{sessionId}" || a === "{resumeId}" ? claudeSessionId : a));
}

const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session ids are spliced into a command line typed into the user's shell
 *  (`{sessionId}` / `{resumeId}`), and they arrive from places Atlas does not
 *  control — transcript file names, the SessionStart hook. Only a UUID is
 *  safe to type; anything else could carry shell syntax or a leading `--`. */
export function isSessionUuid(id: string): boolean {
  return SESSION_UUID.test(id);
}

/**
 * Spawn a terminal tab in the given workspace directory and launch a harness
 * in it — Claude Code, `omp`, or a bare Terminal with nothing typed.
 *
 * `existingSessionId` reattaches an existing Atlas session row to the new tab.
 * `resumeSessionId` is the Claude session UUID to `--resume`; without it a
 * fresh UUID is minted and passed as `--session-id`, so the conversation can
 * be resumed later and its transcript located. `harnessId` defaults to
 * whatever was last picked in the New Session modal.
 */
export async function spawnHarnessSession(
  workspacePath: string,
  opts?: { existingSessionId?: string; resumeSessionId?: string; harnessId?: string },
) {
  const harness = resolveHarness(opts?.harnessId ?? get(lastHarnessId));
  const resumeSessionId = opts?.resumeSessionId;
  if (resumeSessionId !== undefined && !isSessionUuid(resumeSessionId)) {
    throw new Error("The session id is not a valid UUID, so it cannot be resumed.");
  }

  // Resuming a conversation that already has a live tab would start a second
  // claude on the same transcript and orphan the first PTY (no row would point
  // at it any more). Show the open one instead.
  if (opts?.existingSessionId) {
    const owned = get(workspaces)
      .flatMap((w) => w.sessions)
      .find((s) => s.id === opts.existingSessionId);
    const openTab = owned?.terminalTabId
      ? get(tabs).find((t) => t.id === owned.terminalTabId)
      : undefined;
    if (owned && openTab && !openTab.spawnError) {
      activeTabId.set(openTab.id);
      focusedSessionId.set(owned.id);
      return { id: owned.id };
    }
    // A tab left on its spawn-error card is dead; replace it.
    if (openTab) await closeSessionTab(openTab.id);
  }

  const tabId = crypto.randomUUID();
  let session: { id: string };
  const claudeSessionId = resumeSessionId ?? crypto.randomUUID();

  if (opts?.existingSessionId) {
    await resumeSession(opts.existingSessionId, tabId, claudeSessionId);
    session = { id: opts.existingSessionId };
  } else {
    const wsName =
      get(workspaces).find((w) => w.path === workspacePath)?.name ??
      stripBundleExtension(basename(workspacePath) || "New session");
    session = await addSession(workspacePath, wsName, tabId, claudeSessionId, harness.id);
  }

  // Session view renders whichever session is focused, so a spawn has to move
  // the focus with it — otherwise the new PTY starts life hidden behind the
  // session that happened to be focused before.
  focusedSessionId.set(session.id);

  addTab({
    type: "terminal",
    id: tabId,
    ptyId: -1,
    cwd: workspacePath,
    ready: false,
    harnessLabel: harness.label,
  });

  // The PTY is spawned by the TerminalSession this tab mounts, so its id lands
  // on the tab a moment later; wait for it rather than for a clock.
  void awaitTabPty(tabId).then((tab) => {
    if (!tab) {
      // Closed while waiting, or the shell never came up: the second case
      // leaves a tab on "Starting…" (or its error card) and a row that would
      // otherwise read `starting` forever.
      const stuck = get(tabs).find((t) => t.id === tabId);
      if (stuck) {
        updateSessionStatus(session.id, "error");
        if (!stuck.spawnError) showToast("Terminal failed to start", { type: "error" });
      }
      return;
    }

    // Terminal: nothing to type, and nothing shaped like a TUI to wait on —
    // no 300ms delay for a shell prompt, no 5s alt-screen fallback.
    if (harness.command === "") {
      updateSessionStatus(session.id, "running");
      setTabReady(tabId);
      return;
    }

    const argv = resumeSessionId && harness.resumeArgs ? harness.resumeArgs : harness.args;
    const args = resolveArgs(argv, claudeSessionId);
    /* Submit with CR, not LF: CR is what the Enter key sends and what
       ConPTY/PSReadLine needs to run the line instead of just breaking
       it. `submitReview.ts` already writes "\r" for the same reason. */
    const cmd = `${harness.command}${args.length > 0 ? ` ${args.join(" ")}` : ""}\r`;
    // Small delay to let the shell prompt render.
    setTimeout(async () => {
      // Re-check: the tab may have been closed during the delay,
      // in which case its PTY is dead and the write must be skipped.
      const current = get(tabs).find((t) => t.id === tabId);
      if (!current || current.ptyId < 0) return;
      try {
        await ptyWrite(current.ptyId, cmd);
      } catch (e) {
        log.error("session", `launch command write failed for tab ${tabId}`, e);
        showToast(`Could not start ${harness.label}`, { body: String(e) });
        updateSessionStatus(session.id, "error");
        return;
      }
      updateSessionStatus(session.id, "running");
      // Tail the session's own transcript for structured live state — which
      // command depends on the harness, and a bare Terminal has none at all —
      // unless the user has turned transcript tailing off in Settings.
      if (get(tailTranscripts)) {
        const kind = transcriptKind(harness);
        if (kind === "claude") {
          startSessionTail(claudeSessionId).catch((e) =>
            log.warn("session", `startSessionTail failed for ${claudeSessionId}: ${e}`),
          );
        } else if (kind === "omp") {
          startOmpTail(claudeSessionId, current.ptyId).catch((e) =>
            log.warn("session", `startOmpTail failed for ${claudeSessionId}: ${e}`),
          );
        }
      }
      if (harness.readyMode === "immediate") {
        setTabReady(tabId);
        return;
      }
      // Readiness is TerminalSession seeing the alternate screen buffer turn
      // on — the one signal that means the TUI itself has started, and not
      // something a shell also emits. Safety fallback after 5s.
      setTimeout(() => {
        const t = get(tabs).find((x) => x.id === tabId);
        if (t && t.ready === false) setTabReady(tabId);
      }, 5000);
    }, 300);
  });

  return session;
}

/**
 * React to `SessionStart`'s own report of which Claude session UUID is live
 * for `tabId`. Almost always a no-op — the id already matches the one Atlas
 * spawned with — but `/clear` and `/compact` can both make Claude Code mint a
 * new one mid-tab, which nothing else tells Atlas. When that happens, this is
 * what keeps the tail — and so the Overview tile's running/idle state —
 * pointed at the transcript that is actually still growing, instead of the
 * one Claude Code walked away from.
 */
export async function handleClaudeSessionStart(tabId: string, claudeSessionId: string) {
  if (!isSessionUuid(claudeSessionId)) {
    log.warn("session", `ignoring SessionStart with a malformed session id for tab ${tabId}`);
    return;
  }
  const session = get(workspaces)
    .flatMap((w) => w.sessions)
    .find((s) => s.terminalTabId === tabId);
  if (!session || session.claudeSessionId === claudeSessionId) return;

  const previous = session.claudeSessionId;
  const rebound = await rebindSessionClaudeId(tabId, claudeSessionId);
  if (!rebound) return;

  await endSessionTail(previous);
  if (get(tailTranscripts)) {
    startSessionTail(claudeSessionId).catch((e) =>
      log.warn("session", `startSessionTail failed for ${claudeSessionId}: ${e}`),
    );
  }
}

/**
 * Focus an Atlas session, spawning or resuming its Claude process if it is not
 * already running in an open tab.
 */
export function openSession(workspacePath: string, sessionId: string) {
  activeWorkspacePath.set(workspacePath);
  activeSessionId.set(sessionId);

  const ws = get(workspaces).find((w) => w.path === workspacePath);
  const session = ws?.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  if (spawningSessionIds.has(session.id)) return;

  // If the session is running and has a terminal tab, switch to it
  if (session.terminalTabId && session.status === "running") {
    const existing = get(tabs).find((t) => t.id === session.terminalTabId);
    if (existing) {
      activeTabId.set(existing.id);
      return;
    }
  }

  // Spawn a fresh Claude session if not actively running (or running with a missing tab)
  if (session.status !== "running" || !get(tabs).find((t) => t.id === session.terminalTabId)) {
    spawningSessionIds.add(session.id);
    spawnHarnessSession(workspacePath, {
      existingSessionId: session.id,
      resumeSessionId: session.claudeSessionId ?? undefined,
      harnessId: session.harnessId ?? "claude-code",
    })
      .catch((e) => {
        log.error("session", `openSession failed for ${session.id}`, e);
        showToast("Could not open the session", { body: String(e) });
      })
      .finally(() => spawningSessionIds.delete(session.id));
  }
}

/**
 * End a running session: kill the PTY, stop the tail, and release the tab, but
 * keep the workspace row so the conversation stays resumable.
 */
export async function closeSession(sessionId: string) {
  const ws = get(workspaces).find((w) => w.sessions.some((s) => s.id === sessionId));
  const session = ws?.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  if (session.terminalTabId) await closeSessionTab(session.terminalTabId);
  await endSessionTail(session.claudeSessionId);
  await detachSession(sessionId);

  // Unconditional, matching `backToSessions`: gating this on `focusedSessionId`
  // still matching `sessionId` was the bug — `closeFocusedSession`'s
  // `activeTabId` fallback can resolve a session whose id no longer matches
  // the store, and the gate then silently skips the return to Sessions.
  focusedSessionId.set("");
  showView("sessions");
}

/** `closeSession` for a tab that only knows its own id — the error card a
 *  failed spawn leaves behind. A tab no session row owns is just dropped. */
export async function closeSessionForTab(tabId: string) {
  const session = get(workspaces)
    .flatMap((w) => w.sessions)
    .find((s) => s.terminalTabId === tabId);
  if (session) await closeSession(session.id);
  else await closeSessionTab(tabId);
}

/**
 * End whichever session the Session view is showing — the entry point for the
 * close chord.
 *
 * Resolves the session the same way the view's own ✕ button does: through
 * `focusedSessionId`, falling back to `activeTabId` for a session that has a
 * live tab but no focus recorded against it.
 */
export async function closeFocusedSession() {
  const list = get(workspaces);
  const tabId = tabIdForSession(list, get(focusedSessionId)) || get(activeTabId);
  if (!tabId) return;
  const session = list.flatMap((w) => w.sessions).find((s) => s.terminalTabId === tabId);
  if (session) await closeSession(session.id);
}

/**
 * Take a workspace out of the UI, with a 6s Undo.
 *
 * Nothing is destroyed: the folder on disk is untouched, and the workspace's
 * sessions keep running with their terminal tabs and transcript tails intact.
 * That is deliberate — it is what Undo comes back to.
 */
export async function removeWorkspaceWithUndo(workspacePath: string) {
  const name =
    get(workspaces).find((w) => w.path === workspacePath)?.name ??
    stripBundleExtension(basename(workspacePath));
  await hideWorkspace(workspacePath);
  showToast(`${name} removed`, {
    type: "info",
    body: "Its sessions are hidden. The folder is untouched.",
    action: { label: "Undo", run: () => void unhideWorkspace(workspacePath) },
  });
}

/* ── Permission prompts ─────────────────────────────────────────────────────
 * Answering a blocked tool call means typing into the real TUI — there is no
 * IPC channel for it. Only the Sessions tile calls these now: the Session view
 * shows the terminal itself, and the floating card that used to answer for you
 * sat on top of the very prompt it was describing.
 *
 * Nothing is typed unless `canAnswerPermission` holds: the Notification hook
 * flagged a `permission_prompt` for the tab AND `TerminalSession` reads a
 * permission list with "Yes" highlighted off the terminal's own screen right
 * now. The hook flag alone goes stale the moment the user answers in the
 * terminal, and CR / ESC typed into anything but that list submit whatever is
 * in the input box or interrupt the turn.
 *
 * ⚠ The prompt layout `detectPermissionPrompt` reads, and CR / ESC as the
 * accept / dismiss keys, were written from Claude Code's documented arrow-key
 * list and have not been checked against a live TUI in this build environment.
 * A layout the detector does not recognise therefore offers no Allow / Deny
 * at all; the prompt is still answerable in the terminal itself.
 */

/** Accept the highlighted default option. */
const PERMISSION_ALLOW = "\r";
/** Dismiss the selection list without accepting. */
const PERMISSION_DENY = "\x1b";

/**
 * `sessionId` is the terminal tab id (`TabItem.id`) — the same id
 * `onClaudeNotification` and `onPanelUpdate` report as `session_id`, and the
 * one `setTabNeedsInput` takes. It is *not* the Claude session UUID.
 */
async function answerPendingTool(sessionId: string, keystroke: string): Promise<void> {
  const tab = get(tabs).find((t) => t.id === sessionId);
  if (!canAnswerPermission(tab, get(permissionPromptTabs))) {
    log.warn("session", `answerPendingTool: no permission prompt on screen for tab ${sessionId}`);
    return;
  }
  try {
    await ptyWrite(tab.ptyId, keystroke);
  } catch (e) {
    log.error("session", `answerPendingTool: ptyWrite failed for tab ${sessionId}`, e);
    showToast("Could not answer the prompt", { body: String(e) });
    return;
  }
  setTabNeedsInput(sessionId, false);
}

/** Approve the tool call blocking `sessionId`'s session. */
export async function allowPendingTool(sessionId: string): Promise<void> {
  return answerPendingTool(sessionId, PERMISSION_ALLOW);
}

/** Decline the tool call blocking `sessionId`'s session. */
export async function denyPendingTool(sessionId: string): Promise<void> {
  return answerPendingTool(sessionId, PERMISSION_DENY);
}

/** Native folder picker → new workspace. Returns the path, or null if cancelled. */
export async function addWorkspaceFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select workspace folder",
  });
  if (typeof selected !== "string") return null;
  await addWorkspace(selected);
  return selected;
}
