/** Pure helpers behind the Pull requests screen: sort, search, summaries, checks. */
import type { Check } from "../types/generated/Check";
import type { MarkState } from "./components/ui/StatusMark.svelte";
import { needsMyReview, type Pr } from "./stores/prs";

export type PrSort = "updated" | "created" | "repo" | "ci" | "review";

export const SORT_OPTIONS: { id: PrSort; label: string }[] = [
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Newest" },
  { id: "repo", label: "Repository" },
  { id: "ci", label: "CI status" },
  { id: "review", label: "Needs review" },
];

const CI_RANK: Record<Pr["ciState"], number> = { failed: 0, pending: 1, passed: 2, none: 3 };
const REVIEW_RANK: Record<Pr["reviewState"], number> = {
  review_required: 0,
  changes_requested: 1,
  none: 2,
  approved: 3,
};

const time = (iso: string) => Date.parse(iso) || 0;
const newestFirst = (field: "updatedAt" | "createdAt") => (a: Pr, b: Pr) =>
  time(b[field]) - time(a[field]);

/** Order within one repo card; "repo" orders the cards themselves, so PRs fall back to recency. */
export function sortPrs(prs: Pr[], sort: PrSort, viewer: string | null = null): Pr[] {
  const byUpdated = newestFirst("updatedAt");
  const rank = (a: Pr, b: Pr, f: (p: Pr) => number) => f(a) - f(b) || byUpdated(a, b);
  switch (sort) {
    case "created":
      return [...prs].sort(newestFirst("createdAt"));
    case "ci":
      return [...prs].sort((a, b) => rank(a, b, (p) => CI_RANK[p.ciState]));
    case "review":
      // Asked of the viewer first, then by how much review the PR still lacks.
      return [...prs].sort((a, b) =>
        rank(a, b, (p) => (needsMyReview(p, viewer) ? -1 : REVIEW_RANK[p.reviewState])),
      );
    default:
      return [...prs].sort(byUpdated);
  }
}

/** Title, author, branch or number; `#12` and `12` both match PR 12. */
export function searchPrs(prs: Pr[], query: string): Pr[] {
  const q = query.trim().toLowerCase();
  if (!q) return prs;
  const num = q.replace(/^#/, "");
  return prs.filter(
    (pr) =>
      pr.title.toLowerCase().includes(q) ||
      pr.author.login.toLowerCase().includes(q) ||
      pr.headRefName.toLowerCase().includes(q) ||
      String(pr.number).includes(num),
  );
}

export interface PrStatus {
  state: MarkState;
  word: string;
}

/** The one-word state beside the title; the mark's shape carries it too. */
export function prStatus(pr: Pr): PrStatus {
  if (pr.isDraft) return { state: "idle", word: "Draft" };
  if (pr.ciState === "failed") return { state: "failing", word: "Failing" };
  if (pr.reviewState === "changes_requested") return { state: "attention", word: "Changes requested" };
  if (pr.reviewState === "review_required") return { state: "attention", word: "Needs review" };
  if (pr.ciState === "pending") return { state: "running", word: "Running" };
  if (pr.reviewState === "approved") return { state: "done", word: "Ready" };
  return { state: "idle", word: "Open" };
}

export type Pill = { label: string; tone: "accent" | "danger" | "warn" | "muted" };

export function pillsFor(pr: Pr): Pill[] {
  const out: (Pill | null)[] = [];
  switch (pr.ciState) {
    case "passed":
      out.push({ label: "CI passed", tone: "accent" });
      break;
    case "failed":
      out.push({ label: "CI failed", tone: "danger" });
      break;
    case "pending":
      out.push({ label: "CI pending", tone: "muted" });
      break;
  }
  switch (pr.reviewState) {
    case "approved":
      out.push({ label: "Approved", tone: "accent" });
      break;
    case "changes_requested":
      out.push({ label: "Changes requested", tone: "danger" });
      break;
    case "review_required":
      out.push({ label: "Review required", tone: "warn" });
      break;
  }
  if (pr.commentsCount > 0) {
    out.push({
      label: pr.commentsCount === 1 ? "1 comment" : `${pr.commentsCount} comments`,
      tone: "muted",
    });
  }
  return out.filter((p): p is Pill => p !== null);
}

export interface CheckGroups {
  failing: Check[];
  running: Check[];
  passed: Check[];
}

export function groupChecks(checks: Check[]): CheckGroups {
  return {
    failing: checks.filter((c) => c.status === "fail"),
    running: checks.filter((c) => c.status === "pending"),
    passed: checks.filter((c) => c.status === "pass"),
  };
}

/** "Try again in 3m" for a rate limit lifting at `retryAt` (Unix seconds). */
export function retryLabel(retryAt: number, nowMs: number): string {
  const secs = Math.ceil(retryAt - nowMs / 1000);
  if (retryAt <= 0 || secs <= 0) return "Try again now";
  return secs < 60 ? `Try again in ${secs}s` : `Try again in ${Math.ceil(secs / 60)}m`;
}

/** The command a failed checkout was running, for the user to try by hand. */
export function checkoutCommand(pr: Pr): string {
  return pr.isCrossRepository
    ? `git fetch origin pull/${pr.number}/head:pr-${pr.number} && git checkout pr-${pr.number}`
    : `git checkout ${pr.headRefName}`;
}
