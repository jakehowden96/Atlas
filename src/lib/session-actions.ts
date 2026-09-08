/**
 * Terminal-session lifecycle, lifted out of `App.svelte`'s inline handlers.
 *
 * Everything here is a plain function over the stores, so the Mission Control
 * views (Overview tiles, Session header, New Session modal, jump palette) can
 * all drive the same code paths without a component in the middle.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { get } from "svelte/store";
import { ptyKill, ptyWrite, startSessionTail, stopSessionTail } from "./ipc";
import { log } from "./logger";
import { removeLiveSession } from "./stores/liveSessions";
import { skipPermissions } from "./stores/settings";
import {
  activeTabId,
  addTab,
  removeTab,
  setTabNeedsInput,
  setTabReady,
  tabs,
} from "./stores/terminal";
import {
  activeSessionId,
  activeWorkspacePath,
  addSession,
  addWorkspace,
  removeSession,
  removeWorkspace,
  resumeSession,
  stripBundleExtension,
  updateSessionStatus,
  workspaces,
} from "./stores/workspace";

/** Guards against double-spawning while a session is still starting. */
const spawningSessionIds = new Set<string>();

/** Drop a session's transcript tail and its live state once its PTY is gone. */
function endSessionTail(claudeSessionId: string | null | undefined) {
  if (!claudeSessionId) return;
  removeLiveSession(claudeSessionId);
  stopSessionTail(claudeSessionId).catch((e) =>
    log.warn("session", `stopSessionTail failed for ${claudeSessionId}: ${e}`),
  );
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
 * Spawn a terminal tab in the given workspace directory and run `claude`.
 *
 * `existingSessionId` reattaches an existing Atlas session row to the new tab.
 * `resumeSessionId` is the Claude session UUID to `--resume`; without it a
 * fresh UUID is minted and passed as `--session-id`, so the conversation can
 * be resumed later and its transcript located.
 */
export async function spawnClaudeSession(
  workspacePath: string,
  opts?: { existingSessionId?: string; resumeSessionId?: string },
) {
  const tabId = crypto.randomUUID();
  const terminal = new Terminal();
  let session: { id: string };

  const resumeSessionId = opts?.resumeSessionId;
  const claudeSessionId = resumeSessionId ?? crypto.randomUUID();

  if (opts?.existingSessionId) {
    await resumeSession(opts.existingSessionId, tabId, claudeSessionId);
    session = { id: opts.existingSessionId };
  } else {
    const wsName =
      get(workspaces).find((w) => w.path === workspacePath)?.name ??
      stripBundleExtension(workspacePath.split("/").filter(Boolean).pop() ?? "New session");
    session = await addSession(workspacePath, wsName, tabId, claudeSessionId);
  }

  addTab({ type: "terminal", id: tabId, title: "", ptyId: -1, terminal, cwd: workspacePath, ready: false });

  // Once the PTY is ready, send the claude command.
  // We watch for the ptyId to become available via a short poll since
  // handlePtyReady fires inside TerminalContainer.
  let pollAttempts = 0;
  const poll = setInterval(async () => {
    pollAttempts++;
    const currentTabs = get(tabs);
    const tab = currentTabs.find((t) => t.id === tabId);
    // Stop polling if the tab was removed or we've exceeded a reasonable timeout (10s)
    if (!tab || pollAttempts > 100) {
      clearInterval(poll);
      return;
    }
    if (tab.ptyId >= 0) {
      clearInterval(poll);
      const skip = get(skipPermissions) ? " --dangerously-skip-permissions" : "";
      const sessionFlag = resumeSessionId
        ? `--resume ${resumeSessionId}`
        : `--session-id ${claudeSessionId}`;
      const cmd = `claude ${sessionFlag}${skip}\n`;
      // Small delay to let the shell prompt render
      setTimeout(() => {
        // Re-check: the tab may have been closed during the delay,
        // in which case its PTY is dead and the write must be skipped.
        const current = get(tabs).find((t) => t.id === tabId);
        if (!current || current.ptyId < 0) return;
        ptyWrite(current.ptyId, cmd);
        tabs.update((t) =>
          t.map((x) => (x.id === tabId ? { ...x, commandWrittenAt: Date.now() } : x)),
        );
        updateSessionStatus(session.id, "running");
        // Tail the session's own transcript for structured live state.
        startSessionTail(claudeSessionId).catch((e) =>
          log.warn("session", `startSessionTail failed for ${claudeSessionId}: ${e}`),
        );
        // Readiness is triggered by TerminalSession detecting Claude Code's
        // OSC title (after a 300ms gate to skip shell-emitted titles) or
        // alternate screen buffer activation. Safety fallback after 5s.
        setTimeout(() => {
          const t = get(tabs).find((x) => x.id === tabId);
          if (t && t.ready === false) setTabReady(tabId);
        }, 5000);
      }, 300);
    }
  }, 100);

  return session;
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
    spawnClaudeSession(workspacePath, {
      existingSessionId: session.id,
      resumeSessionId: session.claudeSessionId ?? undefined,
    }).finally(() => spawningSessionIds.delete(session.id));
  }
}

/** Close a session's tab, stop tailing it, and drop its workspace row. */
export async function deleteSession(workspacePath: string, sessionId: string) {
  const ws = get(workspaces).find((w) => w.path === workspacePath);
  const session = ws?.sessions.find((s) => s.id === sessionId);
  if (session?.terminalTabId) {
    await closeSessionTab(session.terminalTabId);
  }
  endSessionTail(session?.claudeSessionId);
  await removeSession(workspacePath, sessionId);
}

/** Remove a workspace, tearing down every session it owns first. */
export async function deleteWorkspaceCascade(workspacePath: string) {
  const ws = get(workspaces).find((w) => w.path === workspacePath);
  if (ws) {
    for (const session of ws.sessions) {
      if (session.terminalTabId) {
        await closeSessionTab(session.terminalTabId);
      }
      endSessionTail(session.claudeSessionId);
    }
  }
  await removeWorkspace(workspacePath);
  if (get(activeWorkspacePath) === workspacePath) {
    activeWorkspacePath.set("");
    activeSessionId.set("");
  }
}

/* ── Permission prompts ─────────────────────────────────────────────────────
 * Answering a blocked tool call means typing into the real TUI — there is no
 * IPC channel for it. The Overview tile and phase 06's floating permission
 * card both call these, so the keystroke mapping lives in exactly one place.
 *
 * ⚠ ASSUMPTION — NOT verified against a live TUI. This build environment has
 * no GUI, so `pnpm tauri dev` could not be run to watch what the prompt does.
 * Claude Code's permission prompt is an arrow-key selection list whose first
 * option ("Yes") is highlighted by default, so we send a bare CR to accept the
 * highlighted default and ESC to dismiss. The design prototype's toast copy
 * ("Typed 'y' into the session for you") would only be right if the prompt
 * were a plain y/n confirm, which it is not.
 *
 * TO CONFIRM OR REFUTE: run `pnpm tauri dev` with skip-permissions off, make
 * Claude run a `Bash` command, then click Allow.
 *   - Claude proceeds            → CR is right, keep as is.
 *   - Nothing happens            → the prompt is a y/n confirm; use "y" / "n".
 *   - Allow works, Deny does not → ESC is not wired; deny becomes two
 *     "\x1b[B" (ArrowDown) presses plus "\r" to pick "No, and tell Claude
 *     what to do differently".
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
  if (!tab || tab.ptyId < 0) {
    log.warn("session", `answerPendingTool: no live PTY for tab ${sessionId}`);
    return;
  }
  await ptyWrite(tab.ptyId, keystroke);
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
  const selected = await open({ directory: true, multiple: false, title: "Select workspace folder" });
  if (typeof selected !== "string") return null;
  await addWorkspace(selected);
  return selected;
}
