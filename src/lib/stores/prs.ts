/**
 * Pull-request state, lifted out of `PrsView` so the top bar's attention badge
 * stays live while the Pull requests screen is unmounted. `startPrPolling()` is
 * called once from `App.svelte`; the view is a pure renderer of these stores.
 */
import { derived, get, writable } from "svelte/store";
import { ghViewer, gitRemoteSlug, listRepoPrs } from "../ipc";
import { log } from "../logger";
import { prRefreshMinutes, watchedRepos } from "./settings";
import { showToast } from "./toast";
import type { GhViewer, Pr, RepoPrs } from "../../types/prs";

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
 * Workspace path → its origin `owner/repo`, or null when it has no usable
 * remote. Cached: the remote does not change under us, and this maps repo
 * cards onto the workspace "Work on it" starts a session in.
 */
export const repoSlugsByWorkspace = writable<Record<string, string | null>>({});

export async function loadWorkspaceSlugs(paths: string[]): Promise<void> {
  const known = get(repoSlugsByWorkspace);
  const missing = paths.filter((path) => !(path in known));
  if (missing.length === 0) return;
  const resolved = await Promise.all(
    missing.map(async (path) => {
      try {
        return [path, await gitRemoteSlug(path)] as const;
      } catch (e) {
        log.warn("prs", `git_remote_slug failed for ${path}: ${e}`);
        return [path, null] as const;
      }
    }),
  );
  repoSlugsByWorkspace.update((current) => ({ ...current, ...Object.fromEntries(resolved) }));
}

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
    prRepos.set(await listRepoPrs(get(watchedRepos)));
    prsLastUpdated.set(Date.now());
  } catch (e) {
    log.error("prs", "list_repo_prs failed", e);
    showToast(`Failed to list PRs: ${e}`);
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
  // Fires immediately on subscribe, which is the initial fetch.
  const stopRepos = watchedRepos.subscribe(() => void refreshPrs());
  const stopInterval = prRefreshMinutes.subscribe((minutes) => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void refreshPrs(), Math.max(1, minutes) * 60_000);
  });
  return () => {
    stopRepos();
    stopInterval();
    if (timer) clearInterval(timer);
    timer = null;
  };
}
