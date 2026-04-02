import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PanelData, GitStatus, RepoInfo, AnalysisStatusEvent } from "../types/panel";

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

  return invoke<number>("pty_spawn", {
    cols,
    rows,
    cwd: cwd ?? null,
    envVars: envVars ?? null,
    onData: channel,
  });
}

export async function ptyWrite(id: number, data: string): Promise<void> {
  const encoder = new TextEncoder();
  return invoke("pty_write", { id, data: Array.from(encoder.encode(data)) });
}

export async function ptyResize(
  id: number,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export async function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

export async function getSessionDir(sessionId: string): Promise<string> {
  return invoke("get_session_dir", { sessionId });
}

export async function getPanelData(
  sessionId: string,
): Promise<PanelData | null> {
  return invoke("get_panel_data", { sessionId });
}

export async function refreshPanel(
  sessionId: string,
  cwd: string,
): Promise<PanelData | null> {
  return invoke("refresh_panel", { sessionId, cwd });
}

export async function gitStageAll(cwd: string): Promise<void> {
  return invoke("git_stage_all", { cwd });
}

export async function gitStageFiles(cwd: string, files: string[]): Promise<void> {
  return invoke("git_stage_files", { cwd, files });
}

export async function gitDiscardAll(cwd: string): Promise<void> {
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
  return invoke("git_commit", { cwd, message });
}

export async function gitPush(cwd: string): Promise<string> {
  return invoke("git_push", { cwd });
}

export async function resetAnalysis(sessionId: string): Promise<void> {
  return invoke("reset_analysis", { sessionId });
}

export async function setApiKey(apiKey: string): Promise<void> {
  return invoke("set_api_key", { apiKey });
}

export async function getApiStatus(): Promise<boolean> {
  return invoke("get_api_status");
}

export async function onPanelUpdate(
  callback: (sessionId: string, data: PanelData) => void,
): Promise<UnlistenFn> {
  return listen<{ session_id: string; data: PanelData }>("panel-update", (event) => {
    callback(event.payload.session_id, event.payload.data);
  });
}

export async function onAnalysisStatus(
  callback: (event: AnalysisStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<AnalysisStatusEvent>("analysis-status", (event) => {
    callback(event.payload);
  });
}
