/**
 * Pure helpers behind the New Session modal and the ⌘K jump palette.
 *
 * The keyboard model and the workspace filter live here rather than in the
 * components so they can be unit-tested without a Svelte compiler
 * (README → Conventions).
 */
import { formatAgo } from "./format";
import type { SessionTile } from "./overview";
import type { Workspace } from "./stores/workspace";

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `C:\…` or `C:/…` — the only shape whose case the filesystem ignores. */
const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * Fold a path into a comparable key. Mirrors `normalize_path` in
 * `src-tauri/src/commands/stats.rs`.
 *
 * A transcript's `cwd` comes from the Claude Code process and a workspace path
 * from the folder picker; on Windows the same directory routinely arrives with
 * different separators, drive-letter case and trailing separator. Case is
 * folded only for Windows-shaped paths — on Linux `/A` and `/a` really are
 * different directories.
 */
export function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return WINDOWS_PATH.test(path) ? unified.toLowerCase() : unified;
}

/** The workspace owning `path`, comparing folded forms. */
export function findWorkspace(list: Workspace[], path: string): Workspace | undefined {
  const want = normalizePath(path);
  return list.find((w) => normalizePath(w.path) === want);
}

/** A typed or pasted absolute path, which the modal offers to add as a workspace. */
export function looksLikeAbsolutePath(query: string): boolean {
  const q = query.trim();
  return q.startsWith("/") || q.startsWith("~/") || WINDOWS_PATH.test(q);
}

// ── Workspace list ────────────────────────────────────────────────────────────

/** Latest session start in a workspace; 0 when it has never been used. */
export function recencyOf(ws: Workspace): number {
  let max = 0;
  for (const s of ws.sessions) {
    const t = Date.parse(s.createdAt);
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max;
}

/** Recent first, then narrowed by a name or path substring. */
export function filterWorkspaces(list: Workspace[], query: string): Workspace[] {
  const sorted = [...list].sort((a, b) => recencyOf(b) - recencyOf(a));
  const q = query.trim().toLowerCase();
  if (!q) return sorted;
  const needle = q.replace(/\\/g, "/");
  return sorted.filter(
    (w) =>
      w.name.toLowerCase().includes(q) ||
      w.path.replace(/\\/g, "/").toLowerCase().includes(needle),
  );
}

/** `4m ago` / `3h ago` / `2d ago`, for both the workspace and Resume rows. */
export function ageLabel(iso: string | null, now: Date): string {
  const then = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(then)) return "never";
  return formatAgo(then, now.getTime());
}

// ── Keyboard model ────────────────────────────────────────────────────────────

export type NewSessionMode = "fresh" | "resume";
/** Which column ↑/↓ moves in. Only Resume mode has a second column. */
export type NewSessionColumn = "workspaces" | "resume";

export interface NewSessionState {
  mode: NewSessionMode;
  column: NewSessionColumn;
  /** Index into the filtered workspaces; `counts.workspaces` is the add row. */
  wsIndex: number;
  resumeIndex: number;
}

export interface NewSessionCounts {
  /** Filtered workspace rows, not counting the always-present add row. */
  workspaces: number;
  resumable: number;
}

/** What the component must do; the state change is already applied. */
export type NewSessionEffect = "start" | "close" | "addFolder" | null;

export interface KeyResult {
  state: NewSessionState;
  effect: NewSessionEffect;
  /** False when the key belongs to the text input, not the modal. */
  handled: boolean;
}

export const INITIAL_STATE: NewSessionState = {
  mode: "fresh",
  column: "workspaces",
  wsIndex: 0,
  resumeIndex: 0,
};

function wrap(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (index + delta + total) % total;
}

/**
 * Pull indices back in range after the lists change under them — filtering the
 * workspace list is the common case. Returns the same object when nothing moved
 * so callers can assign unconditionally.
 */
export function clampState(
  state: NewSessionState,
  counts: NewSessionCounts,
): NewSessionState {
  const wsIndex = Math.min(Math.max(0, state.wsIndex), counts.workspaces);
  const resumeIndex =
    counts.resumable === 0
      ? 0
      : Math.min(Math.max(0, state.resumeIndex), counts.resumable - 1);
  const column: NewSessionColumn =
    state.mode === "resume" && counts.resumable > 0 ? state.column : "workspaces";
  if (
    wsIndex === state.wsIndex &&
    resumeIndex === state.resumeIndex &&
    column === state.column
  ) {
    return state;
  }
  return { ...state, wsIndex, resumeIndex, column };
}

/** ↑/↓ inside the focused column, wrapping at both ends. */
export function moveWithin(
  state: NewSessionState,
  counts: NewSessionCounts,
  delta: number,
): NewSessionState {
  if (state.column === "resume") {
    return { ...state, resumeIndex: wrap(state.resumeIndex, counts.resumable, delta) };
  }
  // +1 for the "Add workspace…" row that always sits under the list.
  return { ...state, wsIndex: wrap(state.wsIndex, counts.workspaces + 1, delta) };
}

/**
 * Switch Fresh↔Resume. The selected workspace is deliberately untouched — it is
 * what both modes are about — and focus follows into the Resume list when there
 * is one to pick from.
 */
export function setMode(
  state: NewSessionState,
  mode: NewSessionMode,
  counts: NewSessionCounts,
): NewSessionState {
  const column: NewSessionColumn =
    mode === "resume" && counts.resumable > 0 ? "resume" : "workspaces";
  return { ...state, mode, column };
}

/** Tab / Shift+Tab. Arrow keys are left to the text input's caret. */
export function toggleColumn(
  state: NewSessionState,
  counts: NewSessionCounts,
): NewSessionState {
  if (state.column === "resume") return { ...state, column: "workspaces" };
  if (state.mode !== "resume" || counts.resumable === 0) return state;
  return { ...state, column: "resume" };
}

/**
 * The modal's whole keyboard contract. The caller applies `state` and acts on
 * `effect`; `handled` says whether to `preventDefault`.
 */
export function handleKey(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  state: NewSessionState,
  counts: NewSessionCounts,
): KeyResult {
  const s = clampState(state, counts);
  const mod = e.metaKey === true || e.ctrlKey === true;

  if (mod && e.key.toLowerCase() === "o") {
    return { state: s, effect: "addFolder", handled: true };
  }

  switch (e.key) {
    case "Escape":
      return { state: s, effect: "close", handled: true };
    case "ArrowDown":
      return { state: moveWithin(s, counts, 1), effect: null, handled: true };
    case "ArrowUp":
      return { state: moveWithin(s, counts, -1), effect: null, handled: true };
    case "Tab":
      return { state: toggleColumn(s, counts), effect: null, handled: true };
    case "Enter":
      if (s.column === "workspaces" && s.wsIndex === counts.workspaces) {
        return { state: s, effect: "addFolder", handled: true };
      }
      return { state: s, effect: "start", handled: true };
    default:
      return { state: s, effect: null, handled: false };
  }
}

// ── ⌘K jump palette ───────────────────────────────────────────────────────────

/**
 * Sessions Atlas currently has running, narrowed by a substring of the session
 * label or its workspace name. A session jumper, not a command palette.
 */
export function filterJumpRows(tiles: SessionTile[], query: string): SessionTile[] {
  const q = query.trim().toLowerCase();
  if (!q) return tiles;
  return tiles.filter(
    (t) =>
      t.label.toLowerCase().includes(q) ||
      t.workspaceName.toLowerCase().includes(q) ||
      t.branch.toLowerCase().includes(q),
  );
}
