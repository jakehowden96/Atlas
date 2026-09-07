import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BranchInfo, GitStatus, PanelData, RepoInfo } from "../types/panel";
import type { RepoPrs } from "../types/prs";
import type { StatsSummary } from "../types/stats";
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

export async function gitStageAll(cwd: string): Promise<void> {
  log.info("ipc", `gitStageAll: ${cwd}`);
  return invoke("git_stage_all", { cwd });
}

export async function gitStageFiles(cwd: string, files: string[]): Promise<void> {
  log.info("ipc", `gitStageFiles: ${files.length} files in ${cwd}`);
  return invoke("git_stage_files", { cwd, files });
}

export async function gitDiscardAll(cwd: string): Promise<void> {
  log.info("ipc", `gitDiscardAll: ${cwd}`);
  return invoke("git_discard_all", { cwd });
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  return invoke("get_git_status", { cwd });
}

export async function getChildRepos(cwd: string): Promise<RepoInfo[]> {
  return invoke("get_child_repos", { cwd });
}

export async function gitFetch(cwd: string): Promise<void> {
  return invoke("git_fetch", { cwd });
}

export async function gitPull(cwd: string): Promise<void> {
  return invoke("git_pull", { cwd });
}

export async function gitCommit(
  cwd: string,
  message: string,
): Promise<void> {
  log.info("ipc", `gitCommit: ${cwd}`);
  return invoke("git_commit", { cwd, message });
}

export async function gitPush(cwd: string): Promise<string> {
  log.info("ipc", `gitPush: ${cwd}`);
  return invoke("git_push", { cwd });
}

export async function gitListBranches(cwd: string): Promise<BranchInfo[]> {
  return invoke("git_list_branches", { cwd });
}

export async function gitCheckoutBranch(cwd: string, branch: string): Promise<void> {
  return invoke("git_checkout_branch", { cwd, branch });
}

export async function gitCreateBranch(cwd: string, branch: string): Promise<void> {
  return invoke("git_create_branch", { cwd, branch });
}

export async function listRepoPrs(repos: string[]): Promise<RepoPrs[]> {
  return invoke("list_repo_prs", { repos });
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

/**
 * Path to the `<uuid>.jsonl` transcript under `~/.claude/projects/` for a
 * session started with `claude --session-id <uuid>`.
 * Null while the transcript does not yet exist.
 */
export async function getSessionTranscriptPath(
  sessionUuid: string,
): Promise<string | null> {
  return invoke("get_session_transcript_path", { sessionUuid });
}

export async function getClaudeStats(): Promise<StatsSummary> {
  return invoke("get_claude_stats");
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
