<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listRepoPrs, openUrl } from "../../ipc";
  import { settingsOpen, watchedRepos } from "../../stores/settings";
  import { showToast } from "../../stores/toast";
  import type { Pr, RepoPrs } from "../../../types/prs";
  import { log } from "../../logger";

  const REFRESH_MS = 3 * 60 * 1000;

  let data: RepoPrs[] | null = $state(null);
  let lastUpdated: number | null = $state(null);
  let loading = $state(false);
  // Track "now" so the relative timestamps tick without waiting on the next
  // refresh. 30 s is fine-grained enough for "Updated 2m ago" to feel live.
  let now = $state(Date.now());
  // Per-repo collapse state. Repos default to open; the user toggles by
  // clicking the section header.
  let collapsed = $state<Record<string, boolean>>({});

  let timer: ReturnType<typeof setInterval> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    const repos = $watchedRepos;
    loading = true;
    try {
      const result = await listRepoPrs(repos);
      data = result;
      lastUpdated = Date.now();
      now = lastUpdated;
    } catch (e) {
      log.error("prs", "list_repo_prs failed", e);
      showToast(`Failed to list PRs: ${e}`);
    } finally {
      loading = false;
    }
  }

  // Re-fetch whenever the watched-repo list changes (added/removed via Settings).
  $effect(() => {
    void $watchedRepos;
    refresh();
  });

  onMount(() => {
    timer = setInterval(refresh, REFRESH_MS);
    tick = setInterval(() => (now = Date.now()), 30 * 1000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (tick) clearInterval(tick);
  });

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
    const diff = ref - updated;
    if (diff < 30_000) return "just now";
    return relativeTime(new Date(updated).toISOString(), ref);
  }

  function openPr(pr: Pr) {
    openUrl(pr.url).catch((e) => showToast(`Failed to open PR: ${e}`));
  }

  function toggleRepo(repo: string) {
    collapsed = { ...collapsed, [repo]: !collapsed[repo] };
  }

  // Pill descriptors — `cls` keys into the .pill-{cls} CSS rules below; if a
  // PR has nothing to say about CI/reviews/comments the pill is omitted.
  function ciPill(s: Pr["ciState"]) {
    switch (s) {
      case "passed":  return { icon: "check_circle", label: "CI passed",  cls: "ok" };
      case "failed":  return { icon: "cancel",       label: "CI failed",  cls: "bad" };
      case "pending": return { icon: "schedule",     label: "CI pending", cls: "pending" };
      default:        return null;
    }
  }

  function reviewPill(s: Pr["reviewState"]) {
    switch (s) {
      case "approved":          return { icon: "task_alt",       label: "Approved",         cls: "ok" };
      case "changes_requested": return { icon: "edit_note",      label: "Changes requested", cls: "bad" };
      case "review_required":   return { icon: "rate_review",    label: "Review required",  cls: "warn" };
      default:                  return null;
    }
  }

  function commentsPill(n: number) {
    if (n === 0) return null;
    return { icon: "chat_bubble", label: String(n), cls: "info" };
  }
</script>

<div class="prs-view">
  <header class="prs-header">
    <div class="title-block">
      <h1 class="prs-title">Pull requests</h1>
      <span class="updated-label">
        {loading ? "Refreshing..." : `Updated ${lastUpdatedLabel(lastUpdated, now)}`}
      </span>
    </div>
    <button
      class="refresh-btn"
      onclick={refresh}
      title="Refresh"
      aria-label="Refresh"
      disabled={loading}
    >
      <span class="material-symbols-outlined" class:spinning={loading}>refresh</span>
    </button>
  </header>

  <div class="prs-body">
    {#if $watchedRepos.length === 0}
      <div class="empty-state">
        <span class="material-symbols-outlined empty-icon">account_tree</span>
        <p class="empty-title">No watched repos</p>
        <p class="empty-subtitle">
          Add some in
          <button class="link-btn" onclick={() => settingsOpen.set(true)}>
            Settings &rsaquo; Pull Requests
          </button>
          to see open PRs grouped by repo.
        </p>
      </div>
    {:else if data === null}
      <div class="empty-state">
        <span class="loading-text">Loading…</span>
      </div>
    {:else}
      {#each data as repoEntry (repoEntry.repo)}
        {@const isCollapsed = collapsed[repoEntry.repo] === true}
        <section class="repo-section">
          <button class="repo-header" onclick={() => toggleRepo(repoEntry.repo)}>
            <span class="material-symbols-outlined chevron" class:rotated={!isCollapsed}>
              chevron_right
            </span>
            <span class="material-symbols-outlined repo-icon">account_tree</span>
            <span class="repo-name">{repoEntry.repo}</span>
            <span class="repo-count">{repoEntry.prs.length}</span>
          </button>

          {#if !isCollapsed}
            {#if repoEntry.error}
              <div class="repo-error">
                <span class="material-symbols-outlined error-icon">error</span>
                <span>{repoEntry.error}</span>
              </div>
            {:else if repoEntry.prs.length === 0}
              <div class="repo-empty">No open pull requests.</div>
            {:else}
              <ul class="pr-list">
                {#each repoEntry.prs as pr (pr.number)}
                  <li class="pr-row">
                    <button class="pr-main" onclick={() => openPr(pr)} title="Open on GitHub">
                      <span
                        class="material-symbols-outlined pr-status"
                        class:draft={pr.isDraft}
                      >
                        {pr.isDraft ? "radio_button_unchecked" : "trip_origin"}
                      </span>
                      <span class="pr-title">{pr.title}</span>
                      <span class="pr-number">#{pr.number}</span>
                      <span class="pr-pills">
                        {#each [
                          { key: "ci",       pill: ciPill(pr.ciState) },
                          { key: "review",   pill: reviewPill(pr.reviewState) },
                          { key: "comments", pill: commentsPill(pr.commentsCount) },
                        ] as slot (slot.key)}
                          {#if slot.pill}
                            <span class="pill pill-{slot.pill.cls}" title={slot.pill.label}>
                              <span class="material-symbols-outlined">{slot.pill.icon}</span>
                              <span class="pill-label">{slot.pill.label}</span>
                            </span>
                          {/if}
                        {/each}
                      </span>
                      <span class="pr-meta">
                        opened {relativeTime(pr.createdAt, now)} by @{pr.author.login}
                      </span>
                    </button>
                    <button
                      class="open-btn"
                      onclick={() => openPr(pr)}
                      title="Open on GitHub"
                      aria-label="Open on GitHub"
                    >
                      <span class="material-symbols-outlined">open_in_new</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </section>
      {/each}
    {/if}
  </div>
</div>

<style>
  .prs-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
    color: var(--on-surface);
    font-family: var(--font-body);
  }

  .prs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--outline-variant);
    flex-shrink: 0;
  }

  .title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .prs-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--primary);
  }

  .updated-label {
    font-size: 11px;
    color: var(--on-surface-variant);
    font-family: var(--font-mono);
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface-variant);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: var(--surface-container-high);
    color: var(--on-surface);
    border-color: color-mix(in srgb, var(--primary) 40%, var(--outline-variant));
  }

  .refresh-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .refresh-btn :global(.material-symbols-outlined) {
    font-size: 1.05rem;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .prs-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* ── Empty / loading ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    text-align: center;
    opacity: 0.85;
  }

  .empty-icon {
    font-size: 2.25rem !important;
    color: var(--on-surface-variant);
    opacity: 0.6;
  }

  .empty-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--on-surface);
  }

  .empty-subtitle {
    margin: 0;
    font-size: 0.8rem;
    color: var(--on-surface-variant);
    line-height: 1.5;
    max-width: 360px;
  }

  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--primary);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .loading-text {
    font-size: 0.8rem;
    color: var(--on-surface-variant);
  }

  /* ── Repo section ── */
  .repo-section {
    background: var(--surface-container-low);
    border: 1px solid var(--outline-variant);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .repo-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    color: var(--on-surface);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12.5px;
    transition: background 0.15s;
  }

  .repo-header:hover {
    background: var(--surface-container);
  }

  .chevron {
    font-size: 1rem !important;
    color: var(--on-surface-variant);
    transition: transform 0.15s ease;
  }

  .chevron.rotated {
    transform: rotate(90deg);
  }

  .repo-icon {
    font-size: 0.95rem !important;
    color: var(--primary);
  }

  .repo-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--on-surface);
  }

  .repo-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--primary);
    background: color-mix(in srgb, var(--primary) 14%, transparent);
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
    font-weight: 600;
  }

  /* ── PR rows ── */
  .pr-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--outline-variant);
  }

  .pr-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.45rem 0.5rem 0.45rem 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--outline-variant) 50%, transparent);
  }

  .pr-row:last-child {
    border-bottom: none;
  }

  .pr-row:hover {
    background: var(--surface-container);
  }

  .pr-main {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    color: var(--on-surface);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-body);
    font-size: 13px;
  }

  .pr-status {
    font-size: 1rem !important;
    color: var(--secondary);
    font-variation-settings: 'FILL' 1;
    flex-shrink: 0;
  }

  .pr-status.draft {
    color: var(--on-surface-variant);
    font-variation-settings: 'FILL' 0;
  }

  .pr-title {
    color: var(--on-surface);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex-shrink: 1;
  }

  .pr-number {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--primary);
    flex-shrink: 0;
  }

  /* ── State pills ── */
  .pr-pills {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    flex-shrink: 0;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid currentColor;
    font-size: 10.5px;
    font-weight: 600;
    font-family: var(--font-body);
    line-height: 1;
    background: color-mix(in srgb, currentColor 14%, transparent);
    white-space: nowrap;
  }

  .pill :global(.material-symbols-outlined) {
    font-size: 11px !important;
  }

  .pill-ok      { color: var(--secondary); }
  .pill-bad     { color: var(--error); }
  .pill-pending { color: var(--yellow); }
  .pill-warn    { color: var(--tertiary); }
  .pill-info    { color: var(--cyan); }

  .pr-meta {
    font-size: 11.5px;
    color: var(--on-surface-variant);
    margin-left: auto;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .open-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }

  .open-btn:hover {
    background: var(--surface-container-high);
    color: var(--primary);
  }

  .open-btn :global(.material-symbols-outlined) {
    font-size: 1rem;
  }

  /* ── Per-repo error / empty ── */
  .repo-error {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--outline-variant);
    background: color-mix(in srgb, var(--error) 8%, transparent);
    color: var(--error);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.4;
  }

  .error-icon {
    font-size: 0.95rem !important;
    color: var(--error);
    flex-shrink: 0;
  }

  .repo-empty {
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--outline-variant);
    color: var(--on-surface-variant);
    font-size: 12px;
    font-style: italic;
  }
</style>
