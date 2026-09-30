import { Channel, type InvokeArgs, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DirList,
  DocList,
  DocsChangedEvent,
  PlanEntry,
  TextFile,
  WriteOutcome,
} from "../types/files";
import type { LspStart } from "../types/lsp";
import type { GitStatus, PanelData } from "../types/panel";
import type { GhViewerResult, RepoPrs, WorkspaceRepo } from "../types/prs";
import type { LiveSession, SessionUpdateEvent } from "../types/session";
import type { ResumableSession, StatsSummary } from "../types/stats";
import type { PtyExit } from "../types/terminal";
import { toIpcError } from "./ipc-error";
import { log } from "./logger";

/**
 * `invoke`, with every rejection turned into an `IpcError`. Backend commands
 * reject with an `AtlasError`; anything else (a plugin, a string) becomes
 * kind `unknown`. Nothing outside this file calls `invoke` for a command.
 */
async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toIpcError(e);
  }
}

/** What the PTY's output channel carries: raw bytes, then one exit message. */
type PtyMessage = ArrayBuffer | { exit: PtyExit };

export interface PtyHandlers {
  onData: (data: Uint8Array) => void;
  /** The shell is gone. Called once, after the last `onData`. */
  onExit: (exit: PtyExit) => void;
}

export async function ptySpawn(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  envVars?: Record<string, string>,
): Promise<number> {
  // The backend sends output as raw bytes, which Tauri delivers as an
  // ArrayBuffer (a JSON number array cost about 3.5x the bytes and a parse per
  // message), and ends with a JSON `{ exit }` message.
  const channel = new Channel<PtyMessage>();
  channel.onmessage = (message) => {
    if ("exit" in message) handlers.onExit(message.exit);
    else handlers.onData(new Uint8Array(message));
  };

  log.info("ipc", `ptySpawn cols=${cols} rows=${rows} cwd=${cwd ?? "default"}`);
  try {
    const id = await call<number>("pty_spawn", {
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
  return call("pty_write", { id, data: Array.from(encoder.encode(data)) });
}

export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return call("pty_resize", { id, cols, rows });
}

export async function ptyKill(id: number, sessionId?: string): Promise<void> {
  log.info("ipc", `ptyKill id=${id} sessionId=${sessionId ?? "none"}`);
  return call("pty_kill", { id, sessionId: sessionId ?? null });
}

export async function getPanelData(sessionId: string): Promise<PanelData | null> {
  try {
    const data = await call<PanelData | null>("get_panel_data", { sessionId });
    return data;
  } catch (e) {
    log.error("ipc", `getPanelData failed for ${sessionId}`, e);
    throw e;
  }
}

export async function refreshPanel(sessionId: string, cwd: string): Promise<PanelData | null> {
  try {
    return await call("refresh_panel", { sessionId, cwd });
  } catch (e) {
    log.error("ipc", `refreshPanel failed for ${sessionId}`, e);
    throw e;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  return call("get_git_status", { cwd });
}

export async function gitCheckoutBranch(cwd: string, branch: string): Promise<void> {
  return call("git_checkout_branch", { cwd, branch });
}

/**
 * The repos under a workspace: the workspace itself when it is a checkout, and
 * otherwise the git repos one directory inside it.
 */
export async function listWorkspaceRepos(workspacePath: string): Promise<WorkspaceRepo[]> {
  return call("list_workspace_repos", { workspacePath });
}

export async function listRepoPrs(repos: string[]): Promise<RepoPrs[]> {
  return call("list_repo_prs", { repos });
}

/**
 * The signed-in GitHub user, or why there is none. `gh` missing or logged out
 * is a result, not a rejection, so the PRs screen can show the fix and degrade
 * to All-only.
 */
export async function ghViewer(): Promise<GhViewerResult> {
  return call("gh_viewer");
}

/**
 * Check a pull request out into the repo at `cwd` with `gh pr checkout`, which
 * fetches the PR's own commits — the only way to reach a fork's branch.
 */
export async function ghPrCheckout(cwd: string, number: number, repo: string): Promise<void> {
  return call("gh_pr_checkout", { cwd, number, repo });
}

export async function openUrl(url: string): Promise<void> {
  return call("open_url", { url });
}

/**
 * Start tailing a session's transcript. Updates then arrive as
 * `session-update` events until `stopSessionTail`.
 */
export async function startSessionTail(sessionUuid: string): Promise<void> {
  log.info("ipc", `startSessionTail ${sessionUuid}`);
  return call("start_session_tail", { sessionUuid });
}

export async function stopSessionTail(sessionUuid: string): Promise<void> {
  return call("stop_session_tail", { sessionUuid });
}

/**
 * Start tailing an OMP session through its terminal's breadcrumb file.
 * Updates then arrive as `session-update` events until `stopSessionTail`.
 */
export async function startOmpTail(sessionUuid: string, ptyId: number): Promise<void> {
  log.info("ipc", `startOmpTail ${sessionUuid} ptyId=${ptyId}`);
  return call("start_omp_tail", { sessionUuid, ptyId });
}

/** What Settings › Claude Code reports about the local Claude Code install. */
export interface ClaudeInfo {
  binary: string | null;
  version: string | null;
  notificationHookInstalled: boolean;
  sessionStartHookInstalled: boolean;
}

/** Never rejects for a missing `claude` — every field degrades instead. */
export async function claudeInfo(): Promise<ClaudeInfo> {
  return call("claude_info");
}

/**
 * Install (`true`) or remove (`false`) Atlas's two hooks in
 * `~/.claude/settings.json`. Only Atlas's own entries are added or removed;
 * rejects — leaving the file exactly as it was — when that file does not parse.
 */
export async function setClaudeHook(enabled: boolean): Promise<void> {
  return call("set_claude_hook", { enabled });
}

export async function onSessionUpdate(
  callback: (sessionUuid: string, session: LiveSession) => void,
): Promise<UnlistenFn> {
  return listen<SessionUpdateEvent>("session-update", (event) => {
    callback(event.payload.session_uuid, event.payload.session);
  });
}

export async function getClaudeStats(): Promise<StatsSummary> {
  return call("get_claude_stats");
}

/**
 * Prior conversations in `cwd`, newest first, for the New Session modal's
 * Resume list. Read from the transcript cache — `claude --resume` is an
 * interactive picker with no machine-readable output.
 */
export async function listResumableSessions(cwd: string): Promise<ResumableSession[]> {
  return call("list_resumable_sessions", { cwd });
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
 * Claude Code's `SessionStart` hook report: which Claude session UUID is now
 * live for a tab, and why. `source` is `"startup"` or `"resume"` — where it
 * always matches the id Atlas asked for — or `"clear"` / `"compact"`, the two
 * cases where Claude Code mints one of its own mid-tab.
 */
export interface ClaudeSessionStart {
  claude_session_id: string;
  source: string;
}

export interface ClaudeSessionStartEvent {
  /** Atlas's own tab id (`ATLAS_SESSION_ID`) — constant across a rotation. */
  session_id: string;
  session_start: ClaudeSessionStart;
}

export async function onClaudeSessionStart(
  callback: (event: ClaudeSessionStartEvent) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeSessionStartEvent>("claude-session-start", (event) => {
    callback(event.payload);
  });
}

/**
 * Every file the editor can open under a workspace — prose, source and config
 * — directories included, already sorted directories-first then by name.
 * Capped at depth 8, 2000 entries and 100 000 directory entries looked at;
 * `truncated` says a cap cut the walk short.
 */
export async function listWorkspaceDocs(workspacePath: string): Promise<DocList> {
  return call("list_workspace_docs", { workspacePath });
}

/** `~/.claude/plans/*.md`; empty — never rejects — when there are none. */
export async function listClaudePlans(): Promise<PlanEntry[]> {
  return call("list_claude_plans");
}

/**
 * One directory's children, flat and unfiltered, for the Open… dialog. Rejects
 * a path that is not an existing absolute directory inside a workspace or a
 * folder added to Files. At most 5000 children come back; `truncated` says
 * there were more.
 */
export async function listDir(path: string): Promise<DirList> {
  return call("list_dir", { path });
}

/**
 * Tell the backend the user just picked this folder in the native dialog, so
 * the Files commands accept it for the rest of the run. Persisting the choice
 * (as a workspace or a file source) is what keeps it allowed after a restart.
 */
export async function filesGrant(path: string): Promise<void> {
  return call("files_grant", { path });
}

/** Rejects a path that is not an existing absolute directory; reads nothing. */
export async function validateDirectory(path: string): Promise<void> {
  return call("validate_directory", { path });
}

/**
 * Reads and writes are limited to registered workspaces, folders added to
 * Files, and `~/.claude/plans`, and never reach `~/.atlas` or Claude Code's
 * `settings*.json`; anything else rejects.
 *
 * Rejects anything whose extension the Files screen cannot open.
 */
export async function readTextFileAt(path: string): Promise<TextFile> {
  return call("read_text_file_at", { path });
}

/**
 * Creates parent directories for a new file. Same extension gate and scope as
 * above.
 *
 * `expectedMtime` is the `mtime` the file had when it was read. If the file's
 * time is no longer that, nothing is written and the result is a `conflict`;
 * pass null to write unconditionally (a new file, or the user chose to keep
 * their version).
 */
export async function writeTextFileAt(
  path: string,
  contents: string,
  expectedMtime: number | null,
): Promise<WriteOutcome> {
  return call("write_text_file_at", { path, contents, expectedMtime });
}

/**
 * Watch a workspace for document edits made outside Atlas. Changes then arrive
 * as debounced `docs-changed` events until `stopDocsWatch`.
 */
export async function startDocsWatch(workspacePath: string): Promise<void> {
  log.info("ipc", `startDocsWatch ${workspacePath}`);
  return call("start_docs_watch", { workspacePath });
}

export async function stopDocsWatch(workspacePath: string): Promise<void> {
  return call("stop_docs_watch", { workspacePath });
}

/**
 * Fires when the native ⌘Escape menu accelerator is pressed — see `lib.rs`
 * for why that has to be a menu item rather than a JS keydown binding.
 */
export async function onBackToSessions(callback: () => void): Promise<UnlistenFn> {
  return listen("back-to-sessions", () => callback());
}

export async function onDocsChanged(
  callback: (workspacePath: string, relPath: string) => void,
): Promise<UnlistenFn> {
  return listen<DocsChangedEvent>("docs-changed", (event) => {
    callback(event.payload.workspacePath, event.payload.relPath);
  });
}

// ── Atlas state files ───────────────────────────────────────────────────────

/** The two files under `~/.atlas` the backend loads and saves on the webview's
 *  behalf. A closed set: the webview never supplies a path. */
export type StateFileName = "settings" | "workspaces";

export interface StateLoad {
  /** The file's JSON text; null when it is missing or was unusable. */
  contents: string | null;
  /** The file did not parse and was copied to `<name>.json.bak`. */
  recovered: boolean;
}

export async function stateLoad(name: StateFileName): Promise<StateLoad> {
  return call("state_load", { name });
}

/** Atomic and serialised in Rust. Rejects contents that are not JSON. */
export async function stateSave(name: StateFileName, contents: string): Promise<void> {
  return call("state_save", { name, contents });
}

// ── Language servers ────────────────────────────────────────────────────────

/**
 * Ask the backend for a language server for `languageId` rooted at `root`.
 * `notTrusted` means language servers are off for that workspace (the default;
 * the backend reads the user's choice from `settings.json` itself and starts
 * nothing); `noServer` means it is trusted but none is installed, which is the
 * ordinary case for most file types and is not a failure.
 */
export async function lspStart(languageId: string, root: string): Promise<LspStart> {
  return call<LspStart>("lsp_start", { languageId, root });
}

/** Relay one JSON-RPC message. Framing happens on the Rust side. */
export async function lspSend(id: string, message: string): Promise<void> {
  return call("lsp_send", { id, message });
}

/** Stop a server and forget its session. Idempotent. */
export async function lspStop(id: string): Promise<void> {
  return call("lsp_stop", { id });
}

/**
 * A server exited or crashed on its own and the backend has dropped the
 * session. Not sent for an `lspStop`. The next `lspStart` for that pair starts
 * a fresh server.
 */
export async function onLspExit(callback: (id: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string }>("lsp-exit", (event) => {
    callback(event.payload.id);
  });
}

export async function onLspMessage(
  callback: (id: string, message: string) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string; message: string }>("lsp-message", (event) => {
    callback(event.payload.id, event.payload.message);
  });
}
