/**
 * Pull-request state, lifted out of `PrsView` so the top bar's attention badge
 * stays live while the Pull requests screen is unmounted. `startPrPolling()` is
 * called once from `App.svelte`; the view is a pure renderer of these stores.
 */
import { derived, get, writable } from "svelte/store";
import { connectorListPullRequests, listWorkspaceRepos } from "../ipc";
import { setupProblem } from "../pr-setup";
import { log } from "../logger";
import { byKind, connectors, online, reportFetch } from "./connectors";
import { autoAddReposFromWorkspaces, prRefreshMinutes, watchedRepos } from "./settings";
import { showToast } from "./toast";
import { visibleWorkspaces } from "./workspace";
import type { Check } from "../../types/generated/Check";
import type { Pr as BasePr } from "../../types/generated/Pr";
import type { PullRequest } from "../../types/generated/PullRequest";
import type { PullRequestState } from "../../types/generated/PullRequestState";
import type { ReviewState } from "../../types/generated/ReviewState";
import type { WorkspaceRepo } from "../../types/generated/WorkspaceRepo";
import { errorMessage, IpcError } from "../ipc-error";

/** A pull request with the connector's per-check detail. */
export type Pr = BasePr & {
  checks: Check[];
  review: ReviewState;
  /** Absent on PRs that came from the older `gh` path, which only listed open ones. */
  state?: PullRequestState;
  /** What the connector needs to fetch this PR's code. */
  checkoutRef: { repo: string; number: number };
};

/** Why one repo's list failed: an `AtlasError` kind, plus when to retry if rate limited. */
export interface PrRepoError {
  kind: string;
  message: string;
  retryAt?: number;
}

export interface RepoPrs {
  repo: string;
  prs: Pr[];
  error: PrRepoError | null;
}

export type PrFilter = "all" | "mine" | "review";

export const prRepos = writable<RepoPrs[] | null>(null);
export const prsLoading = writable(false);
export const prsLastUpdated = writable<number | null>(null);
/** The signed-in account of the linked pull request connector. */
export const prViewer = derived(byKind, ($k) =>
  $k.pullRequests?.status.kind === "linked" ? { login: $k.pullRequests.status.account } : null,
);
/** No usable connector, offline, rate limited: why there is nothing to show. */
export const prSetupProblem = derived([connectors, prRepos], ([$c, $repos]) =>
  setupProblem($c, $repos),
);
export const prFilter = writable<PrFilter>("all");

/** Every PR across every watched repo, flattened. */
export const allPrs = derived(prRepos, ($repos) => ($repos ?? []).flatMap((r) => r.prs));

export function isMine(pr: Pr, viewer: string | null): boolean {
  return viewer !== null && pr.author.login === viewer;
}

/**
 * Exact, not approximated: `reviewRequestLogins` comes from the
 * connector's review requests, so this is "GitHub asked *me* for a review" rather than
 * "someone's review is outstanding". Team requests carry no login and so never
 * match — a known gap, and the one the exact form trades for precision.
 */
export function needsMyReview(pr: Pr, viewer: string | null): boolean {
  if (viewer === null) return false;
  if (pr.author.login === viewer) return false;
  return pr.reviewRequestLogins.includes(viewer);
}

export function matchesFilter(pr: Pr, filter: PrFilter, viewer: string | null): boolean {
  switch (filter) {
    case "mine":
      return isMine(pr, viewer);
    case "review":
      return needsMyReview(pr, viewer);
    default:
      return true;
  }
}

/**
 * The top bar's Pull-requests badge: a PR in one of these states is asking
 * someone to act. Cross-phase contract — phase 04 renders the count.
 */
export function needsAttention(pr: Pr): boolean {
  return (
    pr.reviewState === "review_required" ||
    pr.reviewState === "changes_requested" ||
    pr.ciState === "failed"
  );
}

export const prsAttentionCount = derived(allPrs, ($prs) => $prs.filter(needsAttention).length);

export const prFilterCounts = derived([allPrs, prViewer], ([$prs, $viewer]) => {
  const login = $viewer?.login ?? null;
  return {
    all: $prs.length,
    mine: $prs.filter((pr) => isMine(pr, login)).length,
    review: $prs.filter((pr) => needsMyReview(pr, login)).length,
  };
});

/**
 * Workspace path → the repos under it, each with its origin `owner/repo`.
 *
 * A workspace is often a folder that *holds* checkouts rather than being one,
 * so the repo a PR belongs to can be a directory inside it. Asking only the
 * workspace root for a remote left those PRs with nowhere to start a session —
 * "Work on it" answered "No workspace linked" for every one of them.
 *
 * Cached: remotes do not change under us.
 */
export const reposByWorkspace = writable<Record<string, WorkspaceRepo[]>>({});

/** Workspace path → its own origin slug, for Settings' workspace list. */
export const repoSlugsByWorkspace = derived(reposByWorkspace, (byWorkspace) => {
  const out: Record<string, string | null> = {};
  for (const [path, repos] of Object.entries(byWorkspace)) {
    out[path] = repos.find((r) => r.path === path)?.slug ?? null;
  }
  return out;
});

/** Where a PR's `owner/repo` lives on disk. */
export interface RepoMatch {
  /** The repo's own working tree — where a branch is checked out. */
  repoPath: string;
  /** The workspace holding it, which is `repoPath` when it is itself one. */
  workspacePath: string;
}

/**
 * Find a PR's `owner/repo` across every workspace, or null when none of them
 * holds it. The two paths differ whenever a workspace is a folder of checkouts
 * rather than a checkout: the card names the workspace, the session runs in
 * the repo.
 */
export function matchRepo(
  byWorkspace: Record<string, WorkspaceRepo[]>,
  slug: string,
): RepoMatch | null {
  const wanted = slug.toLowerCase();
  for (const [workspacePath, repos] of Object.entries(byWorkspace)) {
    const hit = repos.find((r) => r.slug?.toLowerCase() === wanted);
    if (hit) return { repoPath: hit.path, workspacePath };
  }
  return null;
}

/** Paths whose remotes are being resolved right now. */
const resolvingRepoPaths = new Set<string>();

export async function loadWorkspaceRepos(paths: string[]): Promise<void> {
  const known = get(reposByWorkspace);
  const missing = paths.filter((path) => !(path in known) && !resolvingRepoPaths.has(path));
  if (missing.length === 0) return;
  for (const path of missing) resolvingRepoPaths.add(path);
  try {
    const resolved = await Promise.all(
      missing.map(async (path) => {
        try {
          return [path, await listWorkspaceRepos(path)] as const;
        } catch (e) {
          log.warn("prs", `list_workspace_repos failed for ${path}: ${errorMessage(e)}`);
          return [path, [] as WorkspaceRepo[]] as const;
        }
      }),
    );
    reposByWorkspace.update((current) => ({ ...current, ...Object.fromEntries(resolved) }));
  } finally {
    for (const path of missing) resolvingRepoPaths.delete(path);
  }
}

/**
 * What actually gets polled: the user's own list, plus every workspace remote
 * when `autoAddReposFromWorkspaces` is on. The union is derived rather than
 * written back into `watchedRepos`, so turning the toggle off restores the
 * manual list intact instead of deleting the auto-added entries with it.
 */
export const effectiveWatchedRepos = derived(
  [watchedRepos, autoAddReposFromWorkspaces, reposByWorkspace],
  ([$manual, $auto, $byWorkspace]) => {
    if (!$auto) return $manual;
    const union = new Set($manual);
    for (const repos of Object.values($byWorkspace)) {
      for (const repo of repos) {
        if (repo.slug) union.add(repo.slug);
      }
    }
    return [...union];
  },
);

const CI = { pass: "passed", fail: "failed", pending: "pending" } as const;

/** The aggregate pills still read until phase 72; "awaiting" stays quiet, as gh's `none` did. */
const LEGACY_REVIEW = {
  awaiting: "none",
  comments: "none",
  changes: "changes_requested",
  approved: "approved",
} as const;

function toPr(p: PullRequest, repo: string): Pr {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    author: { login: p.author },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    isDraft: p.state === "draft",
    isCrossRepository: p.isCrossRepository,
    headRefName: p.headRefName,
    ciState: p.ci ? CI[p.ci] : "none",
    reviewState: LEGACY_REVIEW[p.review.kind],
    reviewRequestLogins: p.reviewRequestLogins,
    commentsCount: p.commentsCount,
    checks: p.checks,
    review: p.review,
    state: p.state,
    checkoutRef: { repo, number: p.number },
  };
}

function toRepoError(e: unknown): PrRepoError {
  const retryAt = e instanceof IpcError ? e.fields.retryAt : undefined;
  return {
    kind: e instanceof IpcError ? e.kind : "unknown",
    message: errorMessage(e),
    ...(typeof retryAt === "number" ? { retryAt } : {}),
  };
}

/** One repo per call, so a failure stays on that repo's card. */
async function fetchRepo(connectorId: string, repo: string): Promise<RepoPrs> {
  try {
    const prs = await connectorListPullRequests(connectorId, [{ slug: repo }]);
    return { repo, prs: prs.map((p) => toPr(p, repo)), error: null };
  } catch (e) {
    return { repo, prs: [], error: toRepoError(e) };
  }
}

/** Refreshes that have not answered yet. */
let inFlight = 0;
/** The newest refresh; an older one that answers after it is discarded. */
let latestRefresh = 0;
/** Whether the last finished refresh failed, so a run of failures toasts once. */
let lastRefreshFailed = false;

export async function refreshPrs(): Promise<void> {
  const mine = ++latestRefresh;
  inFlight++;
  prsLoading.set(true);
  try {
    const connector = get(byKind).pullRequests;
    const result = connector
      ? await Promise.all(
          get(effectiveWatchedRepos).map((repo) => fetchRepo(connector.info.id, repo)),
        )
      : [];
    if (mine !== latestRefresh) return;
    prRepos.set(result);
    prsLastUpdated.set(Date.now());
    const failed = result.length > 0 && result.every((r) => r.error);
    if (result.some((r) => r.error?.kind === "connectorOffline")) reportFetch(false);
    else if (result.length > 0) reportFetch(true);
    // A setup problem has its own panel; a toast on top would repeat it.
    if (failed && !get(prSetupProblem) && !lastRefreshFailed && get(online)) {
      log.error("prs", "connector_list_pull_requests failed", result[0]?.error);
      showToast("Failed to list PRs", { body: result[0]?.error?.message });
    }
    lastRefreshFailed = failed;
  } finally {
    inFlight--;
    if (mine === latestRefresh) prsLoading.set(false);
  }
}

/** Repos whose rail refresh has not answered yet. */
const repoInFlight = new Set<string>();

/**
 * Refresh one repo's PRs for the session rail, replacing just its entry in
 * `prRepos`. Does nothing while that repo's previous refresh is still out, so
 * the rail's 60s timer never stacks requests. The rail picks `branch`'s PR.
 */
export async function refreshPrsForBranch(repo: string, _branch: string): Promise<void> {
  const connector = get(byKind).pullRequests;
  if (!connector || repoInFlight.has(repo)) return;
  repoInFlight.add(repo);
  try {
    const fresh = await fetchRepo(connector.info.id, repo);
    prRepos.update((all) => {
      const rest = all ?? [];
      return rest.some((r) => r.repo === repo)
        ? rest.map((r) => (r.repo === repo ? fresh : r))
        : [...rest, fresh];
    });
  } finally {
    repoInFlight.delete(repo);
  }
}

/**
 * Fetch now, then keep polling at the configured interval, re-arming whenever
 * the interval or the watched-repo list changes. Returns the teardown.
 */
export function startPrPolling(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  // Resolve remotes from the shell, not just from PrsView: the auto-add union
  // has to be right before the Pull requests screen is ever opened.
  const stopSlugs = visibleWorkspaces.subscribe((ws) => {
    void loadWorkspaceRepos(ws.map((w) => w.path));
  });
  // `effectiveWatchedRepos` hands out a new array on every recompute, and
  // resolving a workspace's remotes recomputes it even when the list is the
  // same; only a different list is worth another connector fan-out.
  let watchedKey: string | null = null;
  // Fires immediately on subscribe, which is the initial fetch.
  const stopRepos = effectiveWatchedRepos.subscribe((repos) => {
    const key = JSON.stringify(repos);
    if (key === watchedKey) return;
    watchedKey = key;
    void refreshPrs();
  });
  // The connector list loads after boot and changes on sign-in or sign-out.
  let connectorKey: string | null = null;
  const stopConnector = byKind.subscribe(($k) => {
    const key = $k.pullRequests ? `${$k.pullRequests.info.id}:${$k.pullRequests.status.kind}` : "";
    if (connectorKey !== null && key !== connectorKey) void refreshPrs();
    connectorKey = key;
  });
  const stopInterval = prRefreshMinutes.subscribe((minutes) => {
    if (timer) clearInterval(timer);
    timer = setInterval(
      () => {
        if (inFlight === 0) void refreshPrs();
      },
      Math.max(1, minutes) * 60_000,
    );
  });
  return () => {
    stopSlugs();
    stopRepos();
    stopConnector();
    stopInterval();
    if (timer) clearInterval(timer);
    timer = null;
  };
}
