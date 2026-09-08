<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getGitStatus, gitCheckoutBranch, openUrl } from "../../ipc";
  import { log } from "../../logger";
  import { spawnClaudeSession } from "../../session-actions";
  import {
    effectiveWatchedRepos,
    loadWorkspaceSlugs,
    matchesFilter,
    prFilter,
    prFilterCounts,
    prRepos,
    prsLastUpdated,
    prsLoading,
    prViewer,
    refreshPrs,
    repoSlugsByWorkspace,
    type PrFilter,
  } from "../../stores/prs";
  import { prRefreshMinutes, settingsOpen } from "../../stores/settings";
  import { showToast } from "../../stores/toast";
  import { showView } from "../../stores/view";
  import { workspaces } from "../../stores/workspace";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import type { Pr } from "../../../types/prs";

  // Track "now" so "refreshed 2m ago" ticks between polls. Fetching itself is
  // owned by the store, so the badge stays live with this view unmounted.
  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    tick = setInterval(() => (now = Date.now()), 30 * 1000);
  });

  onDestroy(() => {
    if (tick) clearInterval(tick);
  });

  // Resolve each workspace's origin remote so repo cards know where a session
  // would start. Cached in the store, so this only shells out for new paths.
  $effect(() => {
    void loadWorkspaceSlugs($workspaces.map((w) => w.path));
  });

  const viewerLogin = $derived($prViewer?.login ?? null);
  // Without a viewer there is nothing to match Mine / Needs my review against,
  // so those segments are hidden and All is the only filter.
  const activeFilter = $derived<PrFilter>(viewerLogin ? $prFilter : "all");

  const filterOptions = $derived<Segment[]>(
    viewerLogin
      ? [
          { id: "all", label: "All", count: $prFilterCounts.all },
          { id: "mine", label: "Mine", count: $prFilterCounts.mine },
          { id: "review", label: "Needs my review", count: $prFilterCounts.review },
        ]
      : [{ id: "all", label: "All", count: $prFilterCounts.all }],
  );

  // A repo with nothing matching drops out of the list, but one that failed to
  // fetch keeps its card so the error stays visible on that repo alone.
  const cards = $derived(
    ($prRepos ?? [])
      .map((entry) => ({
        repo: entry.repo,
        error: entry.error,
        openCount: entry.prs.length,
        prs: entry.prs.filter((pr) => matchesFilter(pr, activeFilter, viewerLogin)),
      }))
      .filter((card) => card.prs.length > 0 || card.error),
  );

  function workspaceFor(repo: string) {
    const slugs = $repoSlugsByWorkspace;
    const slug = repo.toLowerCase();
    return $workspaces.find((w) => slugs[w.path]?.toLowerCase() === slug) ?? null;
  }

  function relativeTime(iso: string, ref: number): string {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return iso;
    const diff = Math.max(0, ref - then);
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  function lastUpdatedLabel(updated: number | null, ref: number): string {
    if (updated == null) return "never";
    if (ref - updated < 30_000) return "just now";
    return relativeTime(new Date(updated).toISOString(), ref);
  }

  type Pill = { label: string; tone: "accent" | "danger" | "warn" | "muted" };

  function ciPill(s: Pr["ciState"]): Pill | null {
    switch (s) {
      case "passed":  return { label: "CI passed",  tone: "accent" };
      case "failed":  return { label: "CI failed",  tone: "danger" };
      case "pending": return { label: "CI pending", tone: "muted" };
      default:        return null;
    }
  }

  function reviewPill(s: Pr["reviewState"]): Pill | null {
    switch (s) {
      case "approved":          return { label: "Approved",           tone: "accent" };
      case "changes_requested": return { label: "Changes requested",  tone: "danger" };
      case "review_required":   return { label: "Review required",    tone: "warn" };
      default:                  return null;
    }
  }

  function commentsPill(n: number): Pill | null {
    if (n === 0) return null;
    return { label: n === 1 ? "1 comment" : `${n} comments`, tone: "muted" };
  }

  function pillsFor(pr: Pr): Pill[] {
    return [ciPill(pr.ciState), reviewPill(pr.reviewState), commentsPill(pr.commentsCount)].filter(
      (p): p is Pill => p !== null,
    );
  }

  function openPr(pr: Pr) {
    openUrl(pr.url).catch((e) => showToast("Failed to open PR", { body: String(e) }));
  }

  /**
   * Start a Claude session on the PR's branch in the linked workspace.
   * The checkout is guarded: a dirty tree warns rather than losing work.
   */
  async function workOnIt(repo: string, pr: Pr) {
    const ws = workspaceFor(repo);
    if (!ws) {
      showToast("No workspace linked", {
        body: `Add ${repo}'s folder in Settings › Workspaces to work on its PRs.`,
        type: "warning",
      });
      settingsOpen.set(true);
      return;
    }
    try {
      const status = await getGitStatus(ws.path);
      if (status.has_unstaged || status.has_staged) {
        showToast(`${ws.name} has uncommitted changes`, {
          body: `Commit or stash them before switching to ${pr.headRefName}.`,
          type: "warning",
        });
        return;
      }
      await gitCheckoutBranch(ws.path, pr.headRefName);
    } catch (e) {
      log.error("prs", `checkout ${pr.headRefName} in ${ws.path} failed`, e);
      showToast(`Could not check out ${pr.headRefName}`, { body: String(e) });
      return;
    }
    await spawnClaudeSession(ws.path);
    showView("session");
  }
</script>

<div class="prs-view">
  <div class="toolbar">
    <SegmentedControl
      options={filterOptions}
      value={activeFilter}
      onChange={(id) => prFilter.set(id as PrFilter)}
    />
    <div class="spacer"></div>
    <span class="meta">
      via gh · refreshed {$prsLoading ? "…" : lastUpdatedLabel($prsLastUpdated, now)} ·
      every {$prRefreshMinutes}m
    </span>
    <button type="button" class="btn" onclick={() => refreshPrs()} disabled={$prsLoading}>
      Refresh
    </button>
    <button type="button" class="btn" onclick={() => settingsOpen.set(true)}>Watched repos</button>
  </div>

  <div class="cards">
    {#if $effectiveWatchedRepos.length === 0}
      <p class="empty">
        No watched repos yet.
        <button type="button" class="link" onclick={() => settingsOpen.set(true)}>
          Add some in Settings › Pull requests
        </button>
        to see open PRs here.
      </p>
    {:else if $prRepos === null}
      <p class="empty">Loading…</p>
    {:else if cards.length === 0}
      <p class="empty">
        {activeFilter === "all" ? "No open pull requests." : "Nothing matches this filter."}
      </p>
    {:else}
      {#each cards as card (card.repo)}
        {@const ws = workspaceFor(card.repo)}
        <section class="card">
          <header class="card-head">
            <span class="ws-dot" style="background: {ws?.color ?? 'var(--surface3)'}"></span>
            <span class="repo">{card.repo}</span>
            <span class="open-count">{card.openCount} open</span>
            <div class="spacer"></div>
            {#if ws}
              <span class="linked">workspace <span class="linked-name">{ws.name}</span></span>
            {:else}
              <button type="button" class="link-ws" onclick={() => settingsOpen.set(true)}>
                Link a workspace to start sessions from PRs
              </button>
            {/if}
          </header>

          {#if card.error}
            <p class="card-error">{card.error}</p>
          {/if}

          {#each card.prs as pr (pr.number)}
            <div class="pr-row">
              <span class="pr-dot" class:draft={pr.isDraft}></span>
              <div class="pr-body">
                <div class="pr-line">
                  <span class="pr-title">{pr.title}</span>
                  <span class="pr-number">#{pr.number}</span>
                  {#if pr.isDraft}<span class="draft-pill">Draft</span>{/if}
                </div>
                <div class="pr-sub">
                  {pr.headRefName} · opened {relativeTime(pr.createdAt, now)} by @{pr.author.login}
                </div>
              </div>
              <div class="pills">
                {#each pillsFor(pr) as pill (pill.label)}
                  <span class="pill pill-{pill.tone}">{pill.label}</span>
                {/each}
              </div>
              <button
                type="button"
                class="btn work"
                title="Start a Claude session on this PR's branch"
                onclick={() => workOnIt(card.repo, pr)}
              >
                Work on it ›_
              </button>
              <button
                type="button"
                class="ext"
                title="Open on GitHub"
                aria-label="Open on GitHub"
                onclick={() => openPr(pr)}
              >
                ↗
              </button>
            </div>
          {/each}
        </section>
      {/each}
    {/if}
  </div>
</div>

<style>
  .prs-view {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
  }

  .toolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 0;
  }

  .spacer {
    flex: 1;
  }

  .meta {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
  }

  .btn {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px 16px;
  }

  .empty {
    margin: 24px 0;
    color: var(--muted);
    font-size: 12.5px;
    text-align: center;
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  /* ── Repo card ─────────────────────────────────────────────────────────── */
  .card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-card-lg);
    background: var(--surface);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .ws-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .repo {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .open-count {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
  }

  .linked {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .linked-name {
    color: var(--text);
  }

  .link-ws {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }

  .card-error {
    margin: 0;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.4;
  }

  /* ── PR row ────────────────────────────────────────────────────────────── */
  .pr-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .pr-row:last-child {
    border-bottom: none;
  }

  .pr-row:hover {
    background: var(--surface2);
  }

  .pr-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  .pr-dot.draft {
    background: var(--muted);
  }

  .pr-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .pr-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .pr-title {
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pr-number {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .draft-pill {
    padding: 0 6px;
    border: 1px solid var(--border2);
    border-radius: 9px;
    color: var(--muted);
    font-size: 10.5px;
    white-space: nowrap;
  }

  .pr-sub {
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pills {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 10px;
    background: color-mix(in srgb, currentColor 14%, transparent);
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .pill-accent { color: var(--accent); }
  .pill-danger { color: var(--danger); }
  .pill-warn   { color: var(--warn); }
  .pill-muted  { color: var(--muted); }

  .work {
    font-size: 11.5px;
  }

  .ext {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 13px;
    cursor: pointer;
  }

  .ext:hover {
    background: var(--surface2);
    color: var(--text);
  }
</style>
