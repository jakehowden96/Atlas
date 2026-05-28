import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { log } from "../logger";

export interface DiffStats {
  files: number;
  added: number;
  removed: number;
}

export interface WorkspaceSession {
  id: string;
  label: string;
  status: "complete" | "running" | "error" | "idle" | "starting";
  age: string;
  toolSessionId: string | null;
  terminalTabId: string | null;
  createdAt: string;
  /** In-memory only; not persisted. Driven by panel-update events. */
  diffStats?: DiffStats;
}

export interface Workspace {
  path: string;
  name: string;
  color?: string;
  sessions: WorkspaceSession[];
}

const MACOS_BUNDLE_EXTENSIONS = /\.(app|framework|bundle|plugin|kext|xpc)$/i;

export function stripBundleExtension(name: string): string {
  return name.replace(MACOS_BUNDLE_EXTENSIONS, "");
}

function formatLabel(raw: string): string {
  return raw
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const STORAGE_DIR = ".atlas";
const STORAGE_FILE = ".atlas/workspaces.json";

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspacePath = writable("");
export const activeSessionId = writable("");

let dirEnsured = false;
async function ensureDir() {
  if (dirEnsured) return;
  const dirExists = await exists(STORAGE_DIR, { baseDir: BaseDirectory.Home });
  if (!dirExists) {
    await mkdir(STORAGE_DIR, { baseDir: BaseDirectory.Home });
  }
  dirEnsured = true;
}

export async function loadWorkspaces() {
  log.info("workspace", "loadWorkspaces started");
  try {
    const fileExists = await exists(STORAGE_FILE, { baseDir: BaseDirectory.Home });
    if (!fileExists) return;
    const raw = await readTextFile(STORAGE_FILE, { baseDir: BaseDirectory.Home });
    const data = JSON.parse(raw) as Workspace[];
    log.info("workspace", `parsed ${data.length} workspaces`);
    const validColors = new Set(WORKSPACE_COLORS);
    for (const ws of data) {
      if (!ws.color || !validColors.has(ws.color)) {
        ws.color = nextAvailableColor(data.filter((w) => w !== ws));
      }
      for (const s of ws.sessions) {
        if (s.status === "running" || s.status === "starting") s.status = "idle";
        s.terminalTabId = null;
        // Migrate old claudeSessionId field
        const legacy = s as unknown as Record<string, unknown>;
        if (legacy.claudeSessionId && !s.toolSessionId) {
          s.toolSessionId = legacy.claudeSessionId as string;
          delete legacy.claudeSessionId;
        }
      }
    }
    workspaces.set(data);
    log.info("workspace", `store updated with ${data.length} workspaces`);
  } catch (e) {
    log.error("workspace", "failed to load workspaces", e);
    console.warn("Failed to load workspaces (starting fresh):", e);
  }
}

async function persist() {
  try {
    await ensureDir();
    const data = get(workspaces);
    // Strip in-memory-only fields (diffStats) before writing to disk.
    const serializable = data.map((w) => ({
      ...w,
      sessions: w.sessions.map(({ diffStats: _diffStats, ...rest }) => rest),
    }));
    await writeTextFile(STORAGE_FILE, JSON.stringify(serializable, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    log.error("workspace", "failed to persist workspaces", e);
    console.error("Failed to persist workspaces:", e);
  }
}

export const WORKSPACE_COLORS = [
  "#e6194B", // red
  "#3cb44b", // green
  "#ffe119", // yellow
  "#4363d8", // blue
  "#f58231", // orange
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#fabed4", // pink
  "#469990", // teal
  "#dcbeff", // lavender
];

export function nextAvailableColor(existing: Workspace[]): string {
  const used = new Set(existing.map((w) => w.color).filter(Boolean));
  return WORKSPACE_COLORS.find((c) => !used.has(c)) ?? WORKSPACE_COLORS[0];
}

export async function addWorkspace(path: string): Promise<boolean> {
  const current = get(workspaces);
  if (current.some((w) => w.path === path)) {
    log.info("workspace", `addWorkspace duplicate: ${path}`);
    activeWorkspacePath.set(path);
    return false;
  }
  const name = stripBundleExtension(path.split("/").filter(Boolean).pop() ?? path);
  const color = nextAvailableColor(current);
  workspaces.set([...current, { path, name, color, sessions: [] }]);
  activeWorkspacePath.set(path);
  await persist();
  log.info("workspace", `addWorkspace: ${path} (${name})`);
  return true;
}

export async function removeWorkspace(path: string) {
  log.info("workspace", `removeWorkspace: ${path}`);
  workspaces.update((ws) => ws.filter((w) => w.path !== path));
  await persist();
}

export async function setWorkspaceColor(path: string, color: string) {
  workspaces.update((ws) =>
    ws.map((w) => (w.path === path ? { ...w, color } : w)),
  );
  await persist();
}

export async function addSession(
  workspacePath: string,
  label: string,
  terminalTabId: string,
): Promise<WorkspaceSession> {
  const session: WorkspaceSession = {
    id: crypto.randomUUID(),
    label: formatLabel(label),
    status: "starting",
    age: "",
    toolSessionId: null,
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
  await persist();
  return session;
}

export async function setToolSessionId(
  sessionId: string,
  toolSessionId: string,
) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId ? { ...s, toolSessionId } : s,
      ),
    })),
  );
  await persist();
}

export async function resumeSession(
  sessionId: string,
  terminalTabId: string,
) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: "running" as const, terminalTabId } : s,
      ),
    })),
  );
  activeSessionId.set(sessionId);
  await persist();
}

export async function updateSessionStatus(
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
  await persist();
}

const labelTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function updateSessionLabelByTabId(tabId: string, label: string) {
  const existing = labelTimers.get(tabId);
  if (existing) clearTimeout(existing);
  labelTimers.set(tabId, setTimeout(async () => {
    labelTimers.delete(tabId);
    const formatted = formatLabel(label);
    let changed = false;
    workspaces.update((ws) =>
      ws.map((w) => ({
        ...w,
        sessions: w.sessions.map((s) => {
          if (s.terminalTabId === tabId && s.label !== formatted) {
            changed = true;
            return { ...s, label: formatted };
          }
          return s;
        }),
      })),
    );
    if (changed) await persist();
  }, 300));
}

export async function removeSession(workspacePath: string, sessionId: string) {
  workspaces.update((ws) =>
    ws.map((w) =>
      w.path === workspacePath
        ? { ...w, sessions: w.sessions.filter((s) => s.id !== sessionId) }
        : w,
    ),
  );
  if (get(activeSessionId) === sessionId) {
    activeSessionId.set("");
  }
  await persist();
}

export function cycleWorkspace(direction: 1 | -1) {
  const ws = get(workspaces);
  if (ws.length < 2) return;
  const currentPath = get(activeWorkspacePath);
  const currentIndex = ws.findIndex((w) => w.path === currentPath);
  const nextIndex = (currentIndex + direction + ws.length) % ws.length;
  activeWorkspacePath.set(ws[nextIndex].path);
}

export function updateSessionDiffStatsByTabId(tabId: string, stats: DiffStats) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.terminalTabId === tabId ? { ...s, diffStats: stats } : s,
      ),
    })),
  );
  // Not persisted — diffStats are in-memory only.
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
