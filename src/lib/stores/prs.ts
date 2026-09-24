/**
 * Pull-request state, lifted out of `PrsView` so the top bar's attention badge
 * stays live while the Pull requests screen is unmounted. `startPrPolling()` is
 * called once from `App.svelte`; the view is a pure renderer of these stores.
 */
import { derived, get, writable } from "svelte/store";
import { ghViewer, listRepoPrs, listWorkspaceRepos } from "../ipc";
import { log } from "../logger";
import { autoAddReposFromWorkspaces, prRefreshMinutes, watchedRepos } from "./settings";
import { showToast } from "./toast";
import { visibleWorkspaces } from "./workspace";
import type { GhViewer, Pr, RepoPrs, WorkspaceRepo } from "../../types/prs";


export type PrFilter = "all" | "mine" | "review";

export const prRepos = writable<RepoPrs[] | null>(null);
export const prsLoading = writable(false);
export const prsLastUpdated = writable<number | null>(null);
export const prViewer = writable<GhViewer | null>(null);
export const prFilter = writable<PrFilter>("all");

/** Every PR across every watched repo, flattened. */
export const allPrs = derived(prRepos, ($repos) => ($repos ?? []).flatMap((r) => r.prs));

export function isMine(pr: Pr, viewer: string | null): boolean {
  return viewer !== null && pr.author.login === viewer;
}

/**
 * Exact, not approximated: `reviewRequestLogins` comes from gh's
 * `reviewRequests`, so this is "GitHub asked *me* for a review" rather than
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

export async function loadWorkspaceRepos(paths: string[]): Promise<void> {
  const known = get(reposByWorkspace);
  const missing = paths.filter((path) => !(path in known));
  if (missing.length === 0) return;
  const resolved = await Promise.all(
    missing.map(async (path) => {
      try {
        return [path, await listWorkspaceRepos(path)] as const;
      } catch (e) {
        log.warn("prs", `list_workspace_repos failed for ${path}: ${e}`);
        return [path, [] as WorkspaceRepo[]] as const;
      }
    }),
  );
  reposByWorkspace.update((current) => ({ ...current, ...Object.fromEntries(resolved) }));
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

async function loadViewer(): Promise<void> {
  try {
    prViewer.set(await ghViewer());
  } catch (e) {
    // gh_viewer resolves to null rather than rejecting, so this is a broken
    // IPC channel — still not worth a toast, the screen degrades to All-only.
    log.warn("prs", `gh_viewer failed: ${e}`);
    prViewer.set(null);
  }
}

export async function refreshPrs(): Promise<void> {
  prsLoading.set(true);
  try {
    prRepos.set(await listRepoPrs(get(effectiveWatchedRepos)));
    prsLastUpdated.set(Date.now());
  } catch (e) {
    log.error("prs", "list_repo_prs failed", e);
    showToast("Failed to list PRs", { body: String(e) });
  } finally {
    prsLoading.set(false);
  }
}

/**
 * Fetch now, then keep polling at the configured interval, re-arming whenever
 * the interval or the watched-repo list changes. Returns the teardown.
 */
export function startPrPolling(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  void loadViewer();
  // Resolve remotes from the shell, not just from PrsView: the auto-add union
  // has to be right before the Pull requests screen is ever opened.
  const stopSlugs = visibleWorkspaces.subscribe((ws) => {
    void loadWorkspaceRepos(ws.map((w) => w.path));
  });
  // Fires immediately on subscribe, which is the initial fetch.
  const stopRepos = effectiveWatchedRepos.subscribe(() => void refreshPrs());
  const stopInterval = prRefreshMinutes.subscribe((minutes) => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void refreshPrs(), Math.max(1, minutes) * 60_000);
  });
  return () => {
    stopSlugs();
    stopRepos();
    stopInterval();
    if (timer) clearInterval(timer);
    timer = null;
  };
}
