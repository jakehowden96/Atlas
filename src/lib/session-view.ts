/**
 * Pure helpers behind the Session view and its activity rail.
 *
 * Same reasoning as `overview.ts`: the joins and the formatting live here so
 * they can be unit-tested without a Svelte compiler (README → Conventions).
 */
import type { Check } from "../types/generated/Check";
import type { PanelData } from "../types/generated/PanelData";
import type { PlanItem } from "../types/generated/PlanItem";
import type { PullRequestState } from "../types/generated/PullRequestState";
import type { ReviewState } from "../types/generated/ReviewState";
import type { Subagent } from "../types/generated/Subagent";
import { parseDiff } from "./diff-parser";
import { toFlat } from "./diff-view";
import { formatAgo } from "./format";
import { formatElapsed, shortToolName } from "./overview";
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
 * `projects` and an empty `diff.raw`. Two repos can collide on the same
 * relative path, so each file keeps the name of the repo it came from.
 */
export function filesTouched(panel: PanelData | null): TouchedFile[] {
  const diff = panel?.diff;
  if (!diff) return [];
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

/** The plan's three statuses, mapped to the design's three checkbox states. */
export function planRowState(item: PlanItem): PlanRowState {
  if (item.status === "completed") return "done";
  if (item.status === "in_progress") return "current";
  return "pending";
}

/**
 * `Explore · 2m 10s · 4 tools`. The design also shows per-subagent tokens,
 * but the transcript's `Task` results carry no usage block, so there is
 * nothing truthful to put there.
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
  return [agent.agentType, elapsed, tools].filter(Boolean).join(" · ");
}

// ── Activity rail (v6) ───────────────────────────────────────────────────────

/** The state a rail tile's mark and ring show. Matches `StatusMark`'s states. */
export type TileState = "running" | "failing" | "attention" | "done" | "idle";

/** A tile opens by itself while it has something to say, and settles shut. */
export function autoOpen(state: TileState): boolean {
  return state === "running" || state === "failing" || state === "attention";
}

/** The user's choice, once they have made one, beats the automatic one. */
export function tileOpen(state: TileState, manual: boolean | undefined): boolean {
  return manual ?? autoOpen(state);
}

/** A headline: a lead drawn at weight 500 in `tone`, then a muted remainder. */
export interface Headline {
  lead: string;
  rest: string;
  tone: "text" | "accent" | "muted";
}

/** A headline as one plain sentence, for accessible names and tooltips. */
export function headlineText(h: Headline): string {
  return `${h.lead}${h.rest}`.trim();
}

function planPosition(plan: PlanItem[]): { index: number; item: PlanItem } | null {
  let at = plan.findIndex((p) => p.status === "in_progress");
  if (at === -1) at = plan.findIndex((p) => p.status !== "completed");
  const item = plan[at];
  return item ? { index: at, item } : null;
}

export function planState(plan: PlanItem[]): TileState {
  if (plan.length === 0) return "idle";
  if (plan.some((p) => p.status === "in_progress")) return "running";
  return plan.every((p) => p.status === "completed") ? "done" : "idle";
}

/** `Step 11 of 14: Parse Retry-After as an HTTP date`, `All 6 steps done`, `No plan yet`. */
export function planHeadline(plan: PlanItem[]): Headline {
  if (plan.length === 0) return { lead: "", rest: "No plan yet", tone: "muted" };
  const pos = planPosition(plan);
  if (!pos) return { lead: `All ${plan.length} steps done`, rest: "", tone: "text" };
  return {
    lead: `Step ${pos.index + 1} of ${plan.length}:`,
    rest: ` ${pos.item.text}`,
    tone: "text",
  };
}

/** The headline once the tile is open: `Step 11 of 14, 10 done`. */
export function planOpenHeadline(plan: PlanItem[]): string {
  const pos = planPosition(plan);
  if (!pos) return headlineText(planHeadline(plan));
  return `Step ${pos.index + 1} of ${plan.length}, ${planCounts(plan).done} done`;
}

export interface RailRowData {
  title: string;
  state: TileState;
  /** The status word, drawn at weight 500 in the state's colour. */
  word: string;
  /** What follows the word, e.g. ` · step 12`. */
  rest: string;
  /** Agents only: type, worktree chip and current action. */
  meta?: string;
  chip?: string;
  action?: string;
  /** PR checks only: the check's details page, with the link's label. */
  href?: string;
  linkLabel?: string;
}

export interface PlanRows {
  running: RailRowData[];
  next: RailRowData[];
  done: RailRowData[];
}

export function planRows(plan: PlanItem[]): PlanRows {
  const rows: PlanRows = { running: [], next: [], done: [] };
  plan.forEach((item, i) => {
    const step = i + 1;
    if (item.status === "completed") {
      rows.done.push({ title: item.text, state: "done", word: "done", rest: ` · step ${step}` });
    } else if (item.status === "in_progress") {
      rows.running.push({
        title: item.text,
        state: "running",
        word: "in progress",
        rest: ` · step ${step} of ${plan.length}`,
      });
    } else {
      rows.next.push({ title: item.text, state: "idle", word: "next", rest: ` · step ${step}` });
    }
  });
  return rows;
}

/** Fraction 0 to 1 for the plan's progress line. */
export function planProgress(plan: PlanItem[]): number {
  return plan.length === 0 ? 0 : planCounts(plan).done / plan.length;
}

export function agentsState(agents: Subagent[]): TileState {
  if (agents.length === 0) return "idle";
  return agents.some((a) => !a.done) ? "running" : "done";
}

/** `4 running, 5 done`, with only the running part drawn in the accent. */
export function agentsHeadline(agents: Subagent[]): Headline {
  if (agents.length === 0) return { lead: "", rest: "No agents yet", tone: "muted" };
  const running = agents.filter((a) => !a.done).length;
  const done = agents.length - running;
  if (running === 0) return { lead: "", rest: `${done} done`, tone: "muted" };
  return { lead: `${running} running`, rest: done > 0 ? `, ${done} done` : "", tone: "accent" };
}

/** The first two running task names, then `+n` for the rest. */
export function agentsDetail(agents: Subagent[]): string {
  const running = agents.filter((a) => !a.done);
  const shown = running.slice(0, 2).map((a) => a.task);
  if (running.length > 2) shown.push(`+${running.length - 2}`);
  return shown.join(", ");
}

/** True when the session or any of its agents works in more than one worktree. */
export function spansWorktrees(worktree: string | null, agents: Subagent[]): boolean {
  const names = new Set<string>([worktree ?? ""]);
  for (const a of agents) if (a.worktree) names.add(a.worktree);
  return names.size > 1;
}

function toolCalls(n: number): string {
  return `${n} tool call${n === 1 ? "" : "s"}`;
}

export function agentRows(
  agents: Subagent[],
  now: number,
  showWorktree: boolean,
): { running: RailRowData[]; done: RailRowData[] } {
  const out: { running: RailRowData[]; done: RailRowData[] } = { running: [], done: [] };
  for (const a of agents) {
    const finished = a.finishedAt ? Date.parse(a.finishedAt) : Number.NaN;
    const elapsed = formatElapsed(a.startedAt, Number.isNaN(finished) ? now : finished);
    const clock = elapsed ? ` ${elapsed}` : "";
    const base = {
      title: a.task,
      meta: a.agentType ?? "general-purpose",
      chip: showWorktree && a.worktree ? a.worktree : undefined,
    };
    if (a.done) {
      out.done.push({
        ...base,
        state: "done",
        word: elapsed ? "done in" : "done",
        rest: `${clock}, ${toolCalls(a.toolCount)}`,
      });
    } else {
      out.running.push({
        ...base,
        state: "running",
        word: "running",
        rest: `${clock}, ${toolCalls(a.toolCount)}`,
        action: a.currentAction ?? undefined,
      });
    }
  }
  return out;
}

/** Keep the head and tail of a long line and put `…` between them. */
export function middleEllipsis(text: string, max = 36): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** `atlas/billing-retry · retry-metrics`, or just the branch, or "". */
export function branchLine(branch: string | null | undefined, worktree: string | null): string {
  return middleEllipsis([branch, worktree].filter(Boolean).join(" · "));
}

export interface ModelInfo {
  name: string;
  /** Picks the `--model-*` token; null for a model the design has no colour for. */
  family: "opus" | "sonnet" | "haiku" | null;
}

/** `claude-sonnet-4-5-20250929` becomes `Sonnet`. */
export function modelInfo(model: string | null): ModelInfo {
  const lower = model?.toLowerCase() ?? "";
  const family = (["opus", "sonnet", "haiku"] as const).find((f) => lower.includes(f));
  if (family) return { name: family[0]!.toUpperCase() + family.slice(1), family };
  return { name: model ?? "—", family: null };
}

/** Context as a whole percent, 0 to 100. */
export function contextPercent(pct: number): number {
  return Math.min(100, Math.max(0, Math.round(pct * 100)));
}

/** `wants to run Bash` for the pending tool, or a generic line without one. */
export function waitingSummary(pending: { name: string } | null): string {
  return pending ? `wants to run ${shortToolName(pending.name)}` : "needs your answer";
}

// ── Rail PR tile ─────────────────────────────────────────────────────────────

/** The slice of a pull request the tile reads. */
export interface RailPr {
  number: number;
  title: string;
  state?: PullRequestState;
  checks: Check[];
  review: ReviewState;
}

export interface PrPhrase {
  text: string;
  tone: "text" | "accent" | "muted" | "danger" | "warn";
  /** The `#n state` phrase is drawn at weight 500. */
  strong?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function checkCounts(pr: RailPr) {
  const count = (s: Check["status"]) => pr.checks.filter((c) => c.status === s).length;
  return { total: pr.checks.length, fail: count("fail"), pending: count("pending"), pass: count("pass") };
}

/** `#482 open`, `#482 draft` (muted) or `#482 merged`. */
export function prOpenHeadline(pr: RailPr): PrPhrase {
  return {
    text: `#${pr.number} ${pr.state ?? "open"}`,
    tone: pr.state === "draft" ? "muted" : "text",
    strong: true,
  };
}

/** `#482 open, 1 of 7 checks failing, 3 review comments`, as phrases to colour. */
export function prHeadline(pr: RailPr): PrPhrase[] {
  const out = [prOpenHeadline(pr)];
  if (pr.state === "merged") return out;
  const { total, fail, pending } = checkCounts(pr);
  if (fail > 0) out.push({ text: `${fail} of ${plural(total, "check")} failing`, tone: "danger" });
  else if (pending > 0) out.push({ text: `${pending} of ${plural(total, "check")} running`, tone: "accent" });
  else if (total > 0) out.push({ text: `${plural(total, "check")} passed`, tone: "muted" });
  const r = pr.review;
  if (r.kind === "awaiting") out.push({ text: "awaiting review", tone: "muted" });
  else if (r.kind === "comments") out.push({ text: plural(r.count, "review comment"), tone: "warn" });
  else if (r.kind === "changes") out.push({ text: "changes requested", tone: "warn" });
  else out.push({ text: "approved", tone: "accent" });
  return out;
}

/** The whole headline as one sentence, for tooltips and the thin rail. */
export function prHeadlineText(pr: RailPr): string {
  return prHeadline(pr)
    .map((p) => p.text)
    .join(", ");
}

/** Failed, else attention, else running, else done once merged, else not yet. */
export function prState(pr: RailPr | null, pollFailed: boolean): TileState {
  if (!pr) return "idle";
  const { fail, pending } = checkCounts(pr);
  if (fail > 0) return "failing";
  if (pr.review.kind === "comments" || pr.review.kind === "changes" || pollFailed) return "attention";
  if (pending > 0) return "running";
  return pr.state === "merged" ? "done" : "idle";
}

export interface PrRows {
  running: RailRowData[];
  attention: RailRowData[];
  other: RailRowData[];
  done: RailRowData[];
}

/** The expanded groups, in order: running, needs attention, other, done. */
export function prRows(pr: RailPr, provider: string): PrRows {
  const rows: PrRows = { running: [], attention: [], other: [], done: [] };
  const { pass } = checkCounts(pr);
  const failing = pr.checks.filter((c) => c.status === "fail");
  for (const c of pr.checks) {
    if (c.status === "pending") {
      rows.running.push({ title: c.name, state: "running", word: "running", rest: "" });
    } else if (c.status === "pass") {
      rows.done.push({ title: c.name, state: "done", word: "passed", rest: "" });
    }
  }
  failing.forEach((c, i) => {
    const last = i === failing.length - 1 && pass > 0;
    rows.attention.push({
      title: c.name,
      state: "failing",
      word: "failing",
      rest: last ? `, ${pass} other ${pass === 1 ? "check" : "checks"} passed` : "",
      ...(c.detailsUrl ? { href: c.detailsUrl, linkLabel: `Open on ${provider}` } : {}),
    });
  });
  const r = pr.review;
  if (r.kind === "comments" || r.kind === "changes") {
    const word = r.kind === "comments" ? plural(r.count, "review comment") : "changes requested";
    rows.attention.push({ title: "Review", state: "attention", word, rest: "" });
  } else if (pr.state !== "merged") {
    const approved = r.kind === "approved";
    rows.other.push({
      title: "Review",
      state: approved ? "done" : "idle",
      word: approved ? "approved" : "awaiting review",
      rest: "",
    });
  }
  return rows;
}

/** `updated 12s ago`, or `last updated 3m ago, GitHub failed` once a refresh failed. */
export function prPollLine(now: number, lastOk: number, failedProvider: string | null): string {
  const ago = formatAgo(lastOk, now, "second");
  return failedProvider ? `last updated ${ago}, ${failedProvider} failed` : `updated ${ago}`;
}
