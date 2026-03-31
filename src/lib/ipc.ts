import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PanelData } from "../types/panel";

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

export async function onPanelUpdate(
  callback: (data: PanelData) => void,
): Promise<UnlistenFn> {
  return listen<PanelData>("panel-update", (event) => {
    callback(event.payload);
  });
}
