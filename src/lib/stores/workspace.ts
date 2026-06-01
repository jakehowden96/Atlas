import { writable, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { log } from "../logger";

export interface WorkspaceSession {
  id: string;
  label: string;
  status: "complete" | "running" | "error" | "idle" | "starting";
  age: string;
  terminalTabId: string | null;
  createdAt: string;
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

export interface DiffStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * In-memory per-session diff stats for sidebar badges.
 * Keyed by terminalTabId (matches the session_id used by onPanelUpdate).
 * Not persisted — recomputed on next file change.
 */
export const sessionDiffStats = writable<Map<string, DiffStats>>(new Map());

export function setSessionDiffStats(sessionId: string, stats: DiffStats | null) {
  sessionDiffStats.update((m) => {
    const next = new Map(m);
    if (stats === null) next.delete(sessionId);
    else next.set(sessionId, stats);
    return next;
  });
}

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
    await writeTextFile(STORAGE_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    log.error("workspace", "failed to persist workspaces", e);
    console.error("Failed to persist workspaces:", e);
  }
}

// Everforest Hard accents (same hexes work for both dark and light modes).
// Pink/teal use the bright/dim accent variants; lavender has no Everforest
// equivalent, so the slot falls back to grey2 — distinct from every accent.
export const WORKSPACE_COLORS = [
  "#e67e80", // red
  "#a7c080", // green
  "#dbbc7f", // yellow
  "#7fbbb3", // blue
  "#e69875", // orange (tertiary)
  "#83c092", // cyan (aqua)
  "#d699b6", // magenta
  "#e0a8c1", // pink (magenta bright)
  "#5a948c", // teal (primary dim)
  "#9da9a0", // lavender → grey2 fallback
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
