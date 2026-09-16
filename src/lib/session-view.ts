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
  /** Relative to the repo the file is in, which is `repo` when there is one. */
  path: string;
  added: number;
  removed: number;
  /**
   * The repo directory the file belongs to, relative to the session's cwd, or
   * "" when the cwd is itself the repo and the path is already unambiguous.
   */
  repo: string;
}

/**
 * Per-file line counts for the rail.
 *
 * The git diff is authoritative here — the transcript only knows which files
 * Claude *opened*, and its own "+3 −1" summaries lag behind the working tree.
 *
 * A session whose cwd holds several repos gets a per-repo breakdown in
 * `projects`, and `diff.raw` is those diffs concatenated. Reading `raw` there
 * loses which repo each file came from and lets two repos collide on the same
 * relative path, so the per-project diffs are read whenever they are present.
 */
export function filesTouched(panel: PanelData | null): TouchedFile[] {
  const diff = panel?.diff;
  if (!diff?.raw) return [];
  const sources = diff.projects?.length
    ? diff.projects.map((p) => ({ repo: p.name, raw: p.raw }))
    : [{ repo: "", raw: diff.raw }];
  return sources.flatMap(({ repo, raw }) =>
    parseDiff(raw).map((file) => {
      const counts = toFlat(file, file.newName);
      return {
        path: file.changeType === "deleted" ? file.oldName : file.newName,
        added: counts.addedCount,
        removed: counts.removedCount,
        repo,
      };
    }),
  );
}

/** One repo's share of the rail's "Files touched" list, in first-seen order. */
export interface RepoFileGroup {
  repo: string;
  files: TouchedFile[];
}

/**
 * Fold `filesTouched`'s flat rows into one group per repo, so the rail shows
 * the repo once as a heading rather than on every line under it.
 */
export function groupFilesByRepo(files: TouchedFile[]): RepoFileGroup[] {
  const groups: RepoFileGroup[] = [];
  const byRepo = new Map<string, RepoFileGroup>();
  for (const file of files) {
    let group = byRepo.get(file.repo);
    if (!group) {
      group = { repo: file.repo, files: [] };
      byRepo.set(file.repo, group);
      groups.push(group);
    }
    group.files.push(file);
  }
  return groups;
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
 *
 * A finished agent's clock stops at the moment it finished. Measuring it
 * against `now` instead left a row that had been done for an hour claiming to
 * have taken an hour.
 */
export function subagentMeta(agent: Subagent, now: number): string {
  const tools = `${agent.toolCount} tool${agent.toolCount === 1 ? "" : "s"}`;
  const finished = agent.finishedAt ? Date.parse(agent.finishedAt) : Number.NaN;
  const until = Number.isNaN(finished) ? now : finished;
  const elapsed = formatElapsed(agent.startedAt, until);
  return elapsed ? `${elapsed} · ${tools}` : tools;
}
