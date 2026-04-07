import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";

export interface WorkspaceSession {
  id: string;
  label: string;
  status: "complete" | "running" | "error" | "idle";
  age: string;
  claudeSessionId: string | null;
  terminalTabId: string | null;
  createdAt: string;
}

export interface Workspace {
  path: string;
  name: string;
  sessions: WorkspaceSession[];
}

const STORAGE_DIR = ".atlas";
const STORAGE_FILE = ".atlas/workspaces.json";

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspacePath = writable("");
export const activeSessionId = writable("");

async function ensureDir() {
  const dirExists = await exists(STORAGE_DIR, { baseDir: BaseDirectory.Home });
  if (!dirExists) {
    await mkdir(STORAGE_DIR, { baseDir: BaseDirectory.Home });
  }
}

export async function loadWorkspaces() {
  try {
    const fileExists = await exists(STORAGE_FILE, { baseDir: BaseDirectory.Home });
    if (!fileExists) return;
    const raw = await readTextFile(STORAGE_FILE, { baseDir: BaseDirectory.Home });
    const data = JSON.parse(raw) as Workspace[];
    // Mark any previously running sessions as idle on load
    for (const ws of data) {
      for (const s of ws.sessions) {
        if (s.status === "running") s.status = "idle";
        s.terminalTabId = null;
      }
    }
    workspaces.set(data);
  } catch {
    // No file or corrupted — start fresh
  }
}

async function persist() {
  try {
    await ensureDir();
    const data = get(workspaces);
    await writeTextFile(STORAGE_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    console.error("Failed to persist workspaces:", e);
  }
}

export function addWorkspace(path: string): boolean {
  const current = get(workspaces);
  if (current.some((w) => w.path === path)) {
    activeWorkspacePath.set(path);
    return false;
  }
  const name = path.split("/").filter(Boolean).pop() ?? path;
  workspaces.set([...current, { path, name, sessions: [] }]);
  activeWorkspacePath.set(path);
  persist();
  return true;
}

export function removeWorkspace(path: string) {
  workspaces.update((ws) => ws.filter((w) => w.path !== path));
  persist();
}

export function addSession(
  workspacePath: string,
  label: string,
  terminalTabId: string,
): WorkspaceSession {
  const session: WorkspaceSession = {
    id: crypto.randomUUID(),
    label,
    status: "running",
    age: "now",
    claudeSessionId: null,
    terminalTabId,
    createdAt: new Date().toISOString(),
  };
  workspaces.update((ws) =>
    ws.map((w) =>
      w.path === workspacePath
        ? { ...w, sessions: [session, ...w.sessions] }
        : w,
    ),
  );
  activeSessionId.set(session.id);
  persist();
  return session;
}

export function setClaudeSessionId(
  sessionId: string,
  claudeSessionId: string,
) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId ? { ...s, claudeSessionId } : s,
      ),
    })),
  );
  persist();
}

export function updateSessionStatus(
  sessionId: string,
  status: WorkspaceSession["status"],
) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId ? { ...s, status } : s,
      ),
    })),
  );
  persist();
}

export function updateSessionAge(sessionId: string, age: string) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId ? { ...s, age } : s,
      ),
    })),
  );
  // Don't persist age updates — they're cosmetic and recomputed
}
