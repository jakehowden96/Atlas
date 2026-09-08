/**
 * Pure helpers behind the Session view and its activity rail.
 *
 * Same reasoning as `overview.ts`: the joins and the formatting live here so
 * they can be unit-tested without a Svelte compiler (README → Conventions).
 */
import type { PanelData } from "../types/panel";
import type { PlanItem, Subagent } from "../types/session";
import { parseDiff } from "./diff-parser";
import { toFlat } from "./diff-view";
import { formatElapsed } from "./overview";
import type { Workspace } from "./stores/workspace";

/** One row of the rail's "Files touched" list. */
export interface TouchedFile {
  path: string;
  added: number;
  removed: number;
}

/**
 * Per-file line counts for the rail.
 *
 * The git diff is authoritative here — the transcript only knows which files
 * Claude *opened*, and its own "+3 −1" summaries lag behind the working tree.
 */
export function filesTouched(panel: PanelData | null): TouchedFile[] {
  const raw = panel?.diff?.raw;
  if (!raw) return [];
  return parseDiff(raw).map((file) => {
    const counts = toFlat(file, file.newName);
    return {
      path: file.changeType === "deleted" ? file.oldName : file.newName,
      added: counts.addedCount,
      removed: counts.removedCount,
    };
  });
}

/**
 * Resolve the focused Atlas session id to the terminal tab that hosts its PTY.
 *
 * Session view is driven by `focusedSessionId`, but the tabs it renders are
 * keyed by `terminalTabId`; `WorkspaceSession` is the only row carrying both.
 * Returns `""` when the session has no live tab, which is the caller's cue to
 * fall back to `activeTabId`.
 */
export function tabIdForSession(workspaceList: Workspace[], sessionId: string): string {
  if (!sessionId) return "";
  for (const ws of workspaceList) {
    const row = ws.sessions.find((s) => s.id === sessionId);
    if (row?.terminalTabId) return row.terminalTabId;
  }
  return "";
}

/** `124k` once past a thousand, `1.2M` past a million, otherwise the count. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function planCounts(plan: PlanItem[]): { done: number; total: number } {
  return {
    done: plan.filter((p) => p.status === "completed").length,
    total: plan.length,
  };
}

export type PlanRowState = "done" | "current" | "pending";

/** `TodoWrite`'s three statuses, mapped to the design's three checkbox states. */
export function planRowState(item: PlanItem): PlanRowState {
  if (item.status === "completed") return "done";
  if (item.status === "in_progress") return "current";
  return "pending";
}

/**
 * `2m 10s · 4 tools`. The design also shows per-subagent tokens, but the
 * transcript's `Task` results carry no usage block, so there is nothing
 * truthful to put there.
 */
export function subagentMeta(agent: Subagent, now: number): string {
  const tools = `${agent.toolCount} tool${agent.toolCount === 1 ? "" : "s"}`;
  const elapsed = formatElapsed(agent.startedAt, now);
  return elapsed ? `${elapsed} · ${tools}` : tools;
}
