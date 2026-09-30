import { writable, derived, get } from "svelte/store";
import { stateLoad } from "../ipc";
import { log } from "../logger";
import { basename } from "../format";
import { isSessionUuid } from "../session-id";
import { createStatePersister } from "../state-persist";
import { reportNewerState, reportStateRecovered, reportStorageFailure } from "../storage-failure";

export interface WorkspaceSession {
  id: string;
  label: string;
  status: "complete" | "running" | "error" | "idle" | "starting";
  terminalTabId: string | null;
  createdAt: string;
  /** UUID handed to `claude --session-id`; null for rows written before Atlas
   *  assigned session ids — those can only be started fresh, never resumed. */
  claudeSessionId: string | null;
  /** The harness this session launches. Null for rows written before harnesses
   *  existed — those predate the feature and were necessarily Claude Code, but
   *  that translation happens at the read site in `session-actions.ts`. */
  harnessId: string | null;
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

/** The schema version `persist` writes. */
export const WORKSPACES_VERSION = 1;

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

const SESSION_STATUSES: WorkspaceSession["status"][] = [
  "complete",
  "running",
  "error",
  "idle",
  "starting",
];

function validSessionId(id: string): string | null {
  if (isSessionUuid(id)) return id;
  log.warn("workspace", "dropping a stored session id that is not a UUID");
  return null;
}

/** A session row read from disk, or null if it is not one. A row is live only
 *  within a run, so whatever Atlas was doing when it last wrote is reset. */
function sanitizeSession(raw: unknown): WorkspaceSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const status = SESSION_STATUSES.find((v) => v === s.status);
  if (typeof s.id !== "string" || typeof s.label !== "string" || !status) return null;
  return {
    id: s.id,
    label: s.label,
    status: status === "running" || status === "starting" ? "idle" : status,
    terminalTabId: null,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : "",
    // Written by a version of Atlas that did not track Claude session ids, or
    // not a UUID: the id is later typed into a shell, so anything else is
    // dropped (the row stays, but can only be started fresh).
    claudeSessionId:
      typeof s.claudeSessionId === "string" ? validSessionId(s.claudeSessionId) : null,
    // Written by a version of Atlas that predates harnesses.
    harnessId: typeof s.harnessId === "string" ? s.harnessId : null,
  };
}

/** A workspace read from disk, or null if it is not one. The colour is left as
 *  found (possibly missing); `loadWorkspaces` retags it against the palette. */
function sanitizeWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.path !== "string" || typeof w.name !== "string") return null;
  const sessions = Array.isArray(w.sessions) ? w.sessions : [];
  return {
    path: w.path,
    name: w.name,
    color: typeof w.color === "string" ? w.color : undefined,
    sessions: sessions.flatMap((entry) => {
      const session = sanitizeSession(entry);
      return session ? [session] : [];
    }),
  };
}

/**
 * Bring a parsed workspaces file up to `WORKSPACES_VERSION`.
 *
 * Version 0 is everything written before versioning: originally a bare array of
 * workspaces, later an object without a `version` key. `newerThanKnown` is true
 * for a file written by a later Atlas; what this build understands still loads,
 * and the backend keeps the original as `workspaces.json.v<N>.bak` before this
 * build's save replaces it.
 */
export function migrateWorkspaces(raw: unknown): {
  stored: ParsedWorkspaces;
  newerThanKnown: boolean;
} {
  if (Array.isArray(raw)) return { stored: { workspaces: raw }, newerThanKnown: false };
  if (!raw || typeof raw !== "object") return { stored: {}, newerThanKnown: false };
  const stored: ParsedWorkspaces = raw;
  const version = typeof stored.version === "number" ? stored.version : 0;
  return { stored, newerThanKnown: version > WORKSPACES_VERSION };
}

/** Writes are held until this has settled, so a workspace added first can
 *  never replace the file with a list that never saw the stored one. */
export async function loadWorkspaces() {
  log.info("workspace", "loadWorkspaces started");
  try {
    const loaded = await stateLoad("workspaces");
    if (loaded.recovered) reportStateRecovered("workspaces");
    if (loaded.contents === null) return;
    const { stored, newerThanKnown } = migrateWorkspaces(JSON.parse(loaded.contents));
    if (newerThanKnown) reportNewerState("workspaces");
    const rawList: unknown[] = Array.isArray(stored.workspaces) ? stored.workspaces : [];
    const removed: unknown[] = Array.isArray(stored.removedWorkspaces)
      ? stored.removedWorkspaces
      : [];
    removedWorkspaces.set(removed.filter((p): p is string => typeof p === "string"));
    // One malformed entry costs that entry, not the whole file.
    const data = rawList.flatMap((entry) => {
      const ws = sanitizeWorkspace(entry);
      return ws ? [ws] : [];
    });
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
    }
    workspaces.set(data);
    log.info("workspace", `store updated with ${data.length} workspaces`);
  } catch (e) {
    log.error("workspace", "failed to load workspaces", e);
    reportStorageFailure("workspaces", "load", e);
  } finally {
    persister.markLoaded();
  }
}

/** The on-disk shape. A hide has to outlive a restart, so it is written
 *  alongside the workspaces rather than kept in memory. */
interface StoredWorkspaces {
  version?: number;
  /** `unknown` on the way in: `loadWorkspaces` validates each entry. */
  workspaces?: unknown[];
  removedWorkspaces?: unknown[];
}

/** The workspaces file as parsed: same keys, nothing about their values
 *  trusted until `loadWorkspaces` has checked them. */
type ParsedWorkspaces = { [K in keyof StoredWorkspaces]?: unknown };

const persister = createStatePersister(
  "workspaces",
  (): StoredWorkspaces => ({
    version: WORKSPACES_VERSION,
    workspaces: get(workspaces),
    removedWorkspaces: get(removedWorkspaces),
  }),
  (e) => {
    log.error("workspace", "failed to persist workspaces", e);
    reportStorageFailure("workspaces", "save", e);
  },
);

/** Write the current workspaces. Coalesced and held until `loadWorkspaces`
 *  has settled — see `createStatePersister`. */
function persist(): Promise<void> {
  return persister.request();
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
export const WORKSPACE_COLORS: readonly [string, ...string[]] = [
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
    // A workspace the user removed is only hidden; adding it again is how they
    // ask for it back.
    if (!get(removedWorkspaces).includes(path)) return false;
    await unhideWorkspace(path);
    return true;
  }
  const name = stripBundleExtension(basename(path));
  const color = nextAvailableColor(current);
  workspaces.set([...current, { path, name, color, sessions: [] }]);
  activeWorkspacePath.set(path);
  await persist();
  log.info("workspace", `addWorkspace: ${path} (${name})`);
  return true;
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
  harnessId: string | null,
): Promise<WorkspaceSession> {
  const session: WorkspaceSession = {
    id: crypto.randomUUID(),
    label: formatLabel(label),
    status: "starting",
    terminalTabId,
    createdAt: new Date().toISOString(),
    claudeSessionId,
    harnessId,
  };
  // Appended, not prepended: array order is insertion order under every
  // ordering mode, and "opened" ordering depends on it directly.
  workspaces.update((ws) =>
    ws.map((w) => (w.path === workspacePath ? { ...w, sessions: [...w.sessions, session] } : w)),
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

/**
 * Point the session row on `tabId` at a different Claude session UUID,
 * without touching anything else. `claudeSessionId` on a row is only the id
 * Atlas *asked* Claude Code to use at spawn — `/clear` and `/compact` can
 * both make Claude Code mint a new one mid-tab, and the `SessionStart` hook's
 * own report is the only way Atlas hears about it.
 *
 * Returns whether anything changed, so the caller can skip re-tailing when
 * the reported id already matches (the ordinary case, on every session start).
 */
export async function rebindSessionClaudeId(
  tabId: string,
  claudeSessionId: string,
): Promise<boolean> {
  if (!isSessionUuid(claudeSessionId)) return false;
  let changed = false;
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) => {
        if (s.terminalTabId === tabId && s.claudeSessionId !== claudeSessionId) {
          changed = true;
          return { ...s, claudeSessionId };
        }
        return s;
      }),
    })),
  );
  if (changed) await persist();
  return changed;
}

export async function updateSessionStatus(sessionId: string, status: WorkspaceSession["status"]) {
  workspaces.update((ws) =>
    ws.map((w) => ({
      ...w,
      sessions: w.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
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
  labelTimers.set(
    tabId,
    setTimeout(async () => {
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
    }, 300),
  );
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
