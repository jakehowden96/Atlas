/**
 * Pure helpers behind the Overview grid.
 *
 * The join, the sort and the filter live here rather than in the components so
 * they can be unit-tested without a Svelte compiler (README → Conventions).
 */
import type { LiveSession, PlanItem, SessionState } from "../types/session";
import type { OverviewOrdering } from "./stores/settings";
import type { DiffStats, Workspace, WorkspaceSession } from "./stores/workspace";

/** Design default ordering: needs-you first, then running/error, then idle. */
const ATTENTION_RANK: Record<SessionState, number> = {
  needsYou: 0,
  running: 1,
  error: 1,
  idle: 2,
};

export interface SessionTile {
  /** Claude session UUID — the `liveSessions` key and the tile's identity. */
  sessionUuid: string;
  /** Atlas session row id; `""` when no workspace row owns this UUID. */
  atlasSessionId: string;
  /** Terminal tab id — the PTY that answers permission prompts. */
  terminalTabId: string | null;
  workspacePath: string;
  workspaceName: string;
  workspaceColour: string;
  label: string;
  branch: string;
  /** `live.state` with the Notification hook's needs-input flag folded in. */
  state: SessionState;
  live: LiveSession;
  diff: DiffStats | null;
}

/**
 * Join every tailed session to the workspace row that owns it.
 *
 * Two different keys meet here: `LiveSession` is keyed by the Claude UUID,
 * while `sessionDiffStats` is keyed by `terminalTabId`. `WorkspaceSession`
 * carries both, so it is the only correct bridge — matching on anything else
 * silently shows another session's diff numbers.
 *
 * `needsInputTabs` are the terminal tabs the Notification hook has flagged
 * (`TabItem.needsInput`). The backend never sets `SessionState::NeedsYou`
 * itself — `live.rs` says so explicitly — so that flag is the real signal.
 */
export function buildTiles(
  sessions: LiveSession[],
  workspaceList: Workspace[],
  diffStats: Map<string, DiffStats>,
  needsInputTabs: ReadonlySet<string>,
): SessionTile[] {
  return sessions.map((live) => {
    let workspace: Workspace | undefined;
    let row: WorkspaceSession | undefined;
    for (const w of workspaceList) {
      const found = w.sessions.find((s) => s.claudeSessionId === live.sessionUuid);
      if (found) {
        workspace = w;
        row = found;
        break;
      }
    }
    const tabId = row?.terminalTabId ?? null;
    return {
      sessionUuid: live.sessionUuid,
      atlasSessionId: row?.id ?? "",
      terminalTabId: tabId,
      workspacePath: workspace?.path ?? "",
      workspaceName: workspace?.name ?? "",
      workspaceColour: workspace?.color ?? "var(--surface3)",
      label: live.title ?? row?.label ?? "Session",
      branch: live.gitBranch ?? "",
      state: tabId !== null && needsInputTabs.has(tabId) ? "needsYou" : live.state,
      live,
      diff: tabId === null ? null : (diffStats.get(tabId) ?? null),
    };
  });
}

/** Attention order. `Array.sort` is stable, so ties keep their arrival order. */
export function compareByAttention(
  a: { state: SessionState },
  b: { state: SessionState },
): number {
  return ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state];
}

/** Workspace order: grouped by workspace name, then by label inside each. */
export function compareByWorkspace(
  a: { workspaceName: string; label: string },
  b: { workspaceName: string; label: string },
): number {
  return (
    a.workspaceName.localeCompare(b.workspaceName) || a.label.localeCompare(b.label)
  );
}

/**
 * The comparator behind Settings › General › Overview ordering. "manual" has
 * no comparator: the grid keeps the order sessions arrived in.
 */
export function tileComparator(
  ordering: OverviewOrdering,
): ((a: SessionTile, b: SessionTile) => number) | null {
  switch (ordering) {
    case "workspace":
      return compareByWorkspace;
    case "manual":
      return null;
    default:
      return compareByAttention;
  }
}

/** `"all"` keeps everything; any other value matches on workspace path. */
export function filterByWorkspace<T extends { workspacePath: string }>(
  tiles: T[],
  filter: string,
): T[] {
  return filter === "all" ? tiles : tiles.filter((t) => t.workspacePath === filter);
}

/**
 * Fixed-width plan bar: `count` segments filled in proportion to completed
 * todos, so the bar stays 140px whatever the plan's length.
 */
export function planSegments(plan: PlanItem[], count = 6): boolean[] {
  const done = plan.filter((p) => p.status === "completed").length;
  const filled = plan.length === 0 ? 0 : Math.round((done / plan.length) * count);
  return Array.from({ length: count }, (_, i) => i < filled);
}

/** `2m 14s` under an hour, `1h 04m` above it. Empty when the start is unknown. */
export function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return "";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (secs >= 3600) {
    const mins = Math.floor((secs % 3600) / 60);
    return `${Math.floor(secs / 3600)}h ${String(mins).padStart(2, "0")}m`;
  }
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}
