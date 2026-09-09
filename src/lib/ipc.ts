import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DirEntry, DocEntry, DocsChangedEvent, PlanEntry } from "../types/files";
import type { GitStatus, PanelData } from "../types/panel";
import type { GhViewer, RepoPrs, WorkspaceRepo } from "../types/prs";
import type { LiveSession, SessionUpdateEvent } from "../types/session";
import type { ResumableSession, StatsSummary } from "../types/stats";
import { log } from "./logger";

export async function ptySpawn(
  cols: number,
  rows: number,
  onData: (data: Uint8Array) => void,
  cwd?: string,
  envVars?: Record<string, string>,
): Promise<number> {
  const channel = new Channel<number[]>();
  channel.onmessage = (data) => {
    onData(new Uint8Array(data));
  };

  log.info("ipc", `ptySpawn cols=${cols} rows=${rows} cwd=${cwd ?? "default"}`);
  try {
    const id = await invoke<number>("pty_spawn", {
      cols,
      rows,
      cwd: cwd ?? null,
      envVars: envVars ?? null,
      onData: channel,
    });
    log.info("ipc", `ptySpawn success: id=${id}`);
    return id;
  } catch (e) {
    log.error("ipc", "ptySpawn failed", e);
    throw e;
  }
}

const encoder = new TextEncoder();

export async function ptyWrite(id: number, data: string): Promise<void> {
  return invoke("pty_write", { id, data: Array.from(encoder.encode(data)) });
}

export async function ptyResize(
  id: number,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export async function ptyKill(id: number, sessionId?: string): Promise<void> {
  log.info("ipc", `ptyKill id=${id} sessionId=${sessionId ?? "none"}`);
  return invoke("pty_kill", { id, sessionId: sessionId ?? null });
}

export async function getSessionDir(sessionId: string): Promise<string> {
  return invoke("get_session_dir", { sessionId });
}

export async function getPanelData(
  sessionId: string,
): Promise<PanelData | null> {
  try {
    const data = await invoke<PanelData | null>("get_panel_data", { sessionId });
    return data;
  } catch (e) {
    log.error("ipc", `getPanelData failed for ${sessionId}`, e);
    throw e;
  }
}

export async function refreshPanel(
  sessionId: string,
  cwd: string,
): Promise<PanelData | null> {
  try {
    return await invoke("refresh_panel", { sessionId, cwd });
  } catch (e) {
    log.error("ipc", `refreshPanel failed for ${sessionId}`, e);
    throw e;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  return invoke("get_git_status", { cwd });
}

export async function gitCheckoutBranch(cwd: string, branch: string): Promise<void> {
  return invoke("git_checkout_branch", { cwd, branch });
}

/**
 * The repos under a workspace: the workspace itself when it is a checkout, and
 * otherwise the git repos one directory inside it.
 */
export async function listWorkspaceRepos(workspacePath: string): Promise<WorkspaceRepo[]> {
  return invoke("list_workspace_repos", { workspacePath });
}

export async function listRepoPrs(repos: string[]): Promise<RepoPrs[]> {
  return invoke("list_repo_prs", { repos });
}

/**
 * The signed-in GitHub user. Resolves to null — never rejects — when `gh` is
 * missing or logged out, so the PRs screen can degrade to All-only.
 */
export async function ghViewer(): Promise<GhViewer | null> {
  return invoke("gh_viewer");
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

/**
 * Start tailing a session's transcript. Updates then arrive as
 * `session-update` events until `stopSessionTail`.
 */
export async function startSessionTail(sessionUuid: string): Promise<void> {
  log.info("ipc", `startSessionTail ${sessionUuid}`);
  return invoke("start_session_tail", { sessionUuid });
}

export async function stopSessionTail(sessionUuid: string): Promise<void> {
  return invoke("stop_session_tail", { sessionUuid });
}

/** What Settings › Claude Code reports about the local Claude Code install. */
export interface ClaudeInfo {
  binary: string | null;
  version: string | null;
  notificationHookInstalled: boolean;
}

/** Never rejects for a missing `claude` — every field degrades instead. */
export async function claudeInfo(): Promise<ClaudeInfo> {
  return invoke("claude_info");
}

export async function onSessionUpdate(
  callback: (sessionUuid: string, session: LiveSession) => void,
): Promise<UnlistenFn> {
  return listen<SessionUpdateEvent>("session-update", (event) => {
    callback(event.payload.session_uuid, event.payload.session);
  });
}

export async function getClaudeStats(): Promise<StatsSummary> {
  return invoke("get_claude_stats");
}

/**
 * Prior conversations in `cwd`, newest first, for the New Session modal's
 * Resume list. Read from the transcript cache — `claude --resume` is an
 * interactive picker with no machine-readable output.
 */
export async function listResumableSessions(cwd: string): Promise<ResumableSession[]> {
  return invoke("list_resumable_sessions", { cwd });
}

export async function onStatsUpdate(
  callback: (summary: StatsSummary) => void,
): Promise<UnlistenFn> {
  return listen<StatsSummary>("stats-update", (event) => {
    callback(event.payload);
  });
}

export async function onPanelUpdate(
  callback: (sessionId: string, data: PanelData) => void,
): Promise<UnlistenFn> {
  return listen<{ session_id: string; data: PanelData }>("panel-update", (event) => {
    callback(event.payload.session_id, event.payload.data);
  });
}

export interface ClaudeNotification {
  notification_type: string;
  title: string;
  message: string;
  timestamp: string;
}

export interface ClaudeNotificationEvent {
  session_id: string;
  notification: ClaudeNotification;
}

export async function onClaudeNotification(
  callback: (event: ClaudeNotificationEvent) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeNotificationEvent>("claude-notification", (event) => {
    callback(event.payload);
  });
}

/**
 * Every file the editor can open under a workspace — prose, source and config
 * — directories included, already sorted directories-first then by name.
 * Capped at depth 8 and 2000 entries.
 */
export async function listWorkspaceDocs(
  workspacePath: string,
): Promise<DocEntry[]> {
  return invoke("list_workspace_docs", { workspacePath });
}

/** `~/.claude/plans/*.md`; empty — never rejects — when there are none. */
export async function listClaudePlans(): Promise<PlanEntry[]> {
  return invoke("list_claude_plans");
}

/**
 * One directory's children, flat and unfiltered, for the Open… dialog. Rejects
 * a path that is not an existing absolute directory.
 */
export async function listDir(path: string): Promise<DirEntry[]> {
  return invoke("list_dir", { path });
}

/** Rejects anything whose extension the Files screen cannot open. */
export async function readTextFileAt(path: string): Promise<string> {
  return invoke("read_text_file_at", { path });
}

/** Creates parent directories for a new file. Same extension gate as above. */
export async function writeTextFileAt(
  path: string,
  contents: string,
): Promise<void> {
  return invoke("write_text_file_at", { path, contents });
}

/**
 * Watch a workspace for document edits made outside Atlas. Changes then arrive
 * as debounced `docs-changed` events until `stopDocsWatch`.
 */
export async function startDocsWatch(workspacePath: string): Promise<void> {
  log.info("ipc", `startDocsWatch ${workspacePath}`);
  return invoke("start_docs_watch", { workspacePath });
}

export async function stopDocsWatch(workspacePath: string): Promise<void> {
  return invoke("stop_docs_watch", { workspacePath });
}

export async function onDocsChanged(
  callback: (workspacePath: string, relPath: string) => void,
): Promise<UnlistenFn> {
  return listen<DocsChangedEvent>("docs-changed", (event) => {
    callback(event.payload.workspacePath, event.payload.relPath);
  });
}
