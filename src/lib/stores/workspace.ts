import { writable, derived, get } from "svelte/store";
import { BaseDirectory, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { log } from "../logger";
import { basename } from "../format";

export interface WorkspaceSession {
  id: string;
  label: string;
  status: "complete" | "running" | "error" | "idle" | "starting";
  terminalTabId: string | null;
  createdAt: string;
  /** UUID handed to `claude --session-id`; null for rows written before Atlas
   *  assigned session ids — those can only be started fresh, never resumed. */
  claudeSessionId: string | null;
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

/**
 * Paths of workspaces removed from view. Removal is a hide, not a delete: the
 * rows stay in `workspaces` so their sessions keep running and Undo has
 * something to come back to, and the folder on disk is never touched.
 */
export const removedWorkspaces = writable<string[]>([]);

/** What the UI lists. Every consumer reads this; `workspaces` is the raw
 *  store the persistence and undo paths work against. */
export const visibleWorkspaces = derived(
  [workspaces, removedWorkspaces],
  ([$workspaces, $removed]) => $workspaces.filter((w) => !$removed.includes(w.path)),
);

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
    // Files written before workspaces could be hidden are a bare array.
    const parsed = JSON.parse(raw) as Workspace[] | StoredWorkspaces;
    const data = Array.isArray(parsed) ? parsed : (parsed.workspaces ?? []);
    removedWorkspaces.set(Array.isArray(parsed) ? [] : (parsed.removedWorkspaces ?? []));
    log.info("workspace", `parsed ${data.length} workspaces`);
    const seen: Workspace[] = [];
    for (const ws of data) {
      // Retagging anything outside the palette is what migrates workspaces
      // off the retired Everforest hexes.
      if (
        !ws.color ||
        !WORKSPACE_COLORS.includes(ws.color) ||
        seen.some((w) => w.color === ws.color)
      ) {
        ws.color = nextAvailableColor(seen);
      }
      seen.push(ws);
      for (const s of ws.sessions) {
        if (s.status === "running" || s.status === "starting") s.status = "idle";
        s.terminalTabId = null;
        // Written by a version of Atlas that did not track Claude session ids.
        s.claudeSessionId = s.claudeSessionId ?? null;
      }
    }
    workspaces.set(data);
    log.info("workspace", `store updated with ${data.length} workspaces`);
  } catch (e) {
    log.error("workspace", "failed to load workspaces", e);
    console.warn("Failed to load workspaces (starting fresh):", e);
  }
}

/** The on-disk shape. A hide has to outlive a restart, so it is written
 *  alongside the workspaces rather than kept in memory. */
interface StoredWorkspaces {
  workspaces?: Workspace[];
  removedWorkspaces?: string[];
}

async function persist() {
  try {
    await ensureDir();
    const data: StoredWorkspaces = {
      workspaces: get(workspaces),
      removedWorkspaces: get(removedWorkspaces),
    };
    await writeTextFile(STORAGE_FILE, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch (e) {
    log.error("workspace", "failed to persist workspaces", e);
    console.error("Failed to persist workspaces:", e);
  }
}

// The Mission Control workspace tag palette. Settings → Workspaces offers
// exactly these twelve as a swatch picker; `loadWorkspaces` reassigns anything
// outside the set, so workspaces tagged with the old Everforest hexes migrate
// on the next load.
//
// The hues are spread around the OKLCH wheel at roughly constant lightness and
// chroma, so the closest pair in the set is no closer than the closest pair the
// original six already contained — an 8px `.ws-dot` stays readable as its own
// tag on both themes (every entry clears 2.7:1 on `#ffffff` and 4.1:1 on
// `#16171a`).
//
// The first six are load-bearing and must stay first, in this order: a
// workspace whose colour falls outside the palette is silently re-tagged on the
// next load, so reordering or replacing them would re-colour every existing
// user's workspaces. New hues are appended.
export const WORKSPACE_COLORS = [
  "#2fa37a",
  "#5b8def",
  "#7c6cf2",
  "#e0873a",
  "#d9455f",
  "#8a8f98",
  "#79a70c",
  "#c65e01",
  "#03a6c6",
  "#d773d0",
  "#948000",
  "#a959c1",
];

export function nextAvailableColor(existing: Workspace[]): string {
  const used = new Set(existing.map((w) => w.color).filter(Boolean));
  // Past twelve workspaces the palette repeats from the top. Deliberate: the
  // picker offers twelve swatches and no thirteenth colour exists to offer.
  return WORKSPACE_COLORS.find((c) => !used.has(c)) ?? WORKSPACE_COLORS[0];
}

export async function addWorkspace(path: string): Promise<boolean> {
  const current = get(workspaces);
  if (current.some((w) => w.path === path)) {
    log.info("workspace", `addWorkspace duplicate: ${path}`);
    activeWorkspacePath.set(path);
    return false;
  }
  const name = stripBundleExtension(basename(path));
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

/**
 * Take a workspace out of the UI without deleting anything. Its sessions stay
 * in the store and keep running; only the listings stop showing it.
 */
export async function hideWorkspace(path: string) {
  let changed = false;
  removedWorkspaces.update((removed) => {
    if (removed.includes(path)) return removed;
    changed = true;
    return [...removed, path];
  });
  if (!changed) return;
  log.info("workspace", `hideWorkspace: ${path}`);
  await persist();
}

/** Undo a hide. The workspace returns in its original position, because it
 *  never left `workspaces` — only the hidden list is edited. */
export async function unhideWorkspace(path: string) {
  let changed = false;
  removedWorkspaces.update((removed) => {
    if (!removed.includes(path)) return removed;
    changed = true;
    return removed.filter((p) => p !== path);
  });
  if (!changed) return;
  log.info("workspace", `unhideWorkspace: ${path}`);
  await persist();
}

export async function setWorkspaceColor(path: string, color: string) {
  workspaces.update((ws) => {
    const target = ws.find((w) => w.path === path);
    const clash = ws.find((w) => w.path !== path && w.color === color);
    return ws.map((w) => {
      if (w.path === path) return { ...w, color };
      if (clash && w.path === clash.path) return { ...w, color: target?.color };
      return w;
    });
  });
  await persist();
}

export async function addSession(
  workspacePath: string,
  label: string,
  terminalTabId: string,
  claudeSessionId: string | null,
): Promise<WorkspaceSession> {
  const session: WorkspaceSession = {
    id: crypto.randomUUID(),
    label: formatLabel(label),
    status: "starting",
    terminalTabId,
    createdAt: new Date().toISOString(),
    claudeSessionId,
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
  claudeSessionId: string,
) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, status: "running" as const, terminalTabId, claudeSessionId }
          : s,
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

/**
 * Mark a session closed: no terminal tab, back to idle. The row itself stays,
 * so the conversation is still listed and `claude --resume`-able. This is the
 * same shape `loadWorkspaces` puts sessions in at startup.
 */
export async function detachSession(sessionId: string) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: "idle" as const, terminalTabId: null } : s,
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
