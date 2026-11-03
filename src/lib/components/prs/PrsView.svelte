<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { setupHint } from "../../pr-setup";
  import { retryLabel, searchPrs, SORT_OPTIONS, sortPrs, type PrSort } from "../../pr-view";
  import {
    effectiveWatchedRepos,
    matchesFilter,
    prFilter,
    prFilterCounts,
    prRepos,
    prsLastUpdated,
    prsLoading,
    prSetupProblem,
    prViewer,
    refreshPrs,
    reposByWorkspace,
    matchRepo,
    type PrFilter,
  } from "../../stores/prs";
  import { byKind } from "../../stores/connectors";
  import { prRefreshMinutes, setWatchedRepos, openSettings, watchedRepos } from "../../stores/settings";
  import { visibleWorkspaces } from "../../stores/workspace";
  import { formatAgo } from "../../format";
  import { tooltip } from "../../ui/tooltip";
  import Banner from "../ui/Banner.svelte";
  import Button from "../ui/Button.svelte";
  import ChipInput from "../ui/ChipInput.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../ui/Icon.svelte";
  import SearchInput from "../ui/SearchInput.svelte";
  import SegmentedControl, { type Segment } from "../ui/SegmentedControl.svelte";
  import Select from "../ui/Select.svelte";
  import Skeleton from "../ui/Skeleton.svelte";
  import PrRow from "./PrRow.svelte";

  // Track "now" so "Updated 2m ago" ticks between polls. Fetching itself is
  // owned by the store, so the badge stays live with this view unmounted.
  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    tick = setInterval(() => (now = Date.now()), 30 * 1000);
  });

  onDestroy(() => {
    if (tick) clearInterval(tick);
  });

  let query = $state("");
  let sort = $state<PrSort>("updated");

  // A missing or expired connector fails every repo the same way, so it gets one
  // explanation in place of a wall of identical card errors.
  const setup = $derived($prSetupProblem ? setupHint($prSetupProblem) : null);
  const rateLimit = $derived($prSetupProblem?.kind === "rateLimited" ? $prSetupProblem : null);
  const providerName = $derived($byKind.pullRequests?.info.name ?? "the service");

  const viewerLogin = $derived($prViewer?.login ?? null);
  // Without a viewer there is nothing to match Mine / Needs my review against,
  // so those segments are hidden and All is the only filter.
  const activeFilter = $derived<PrFilter>(viewerLogin ? $prFilter : "all");

  const filterOptions = $derived<Segment<PrFilter>[]>(
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
        prs: sortPrs(
          searchPrs(
            entry.prs.filter((pr) => matchesFilter(pr, activeFilter, viewerLogin)),
            query,
          ),
          sort,
          viewerLogin,
        ),
      }))
      .filter((card) => card.prs.length > 0 || card.error)
      .sort((a, b) => (sort === "repo" ? a.repo.localeCompare(b.repo) : 0)),
  );

  // Repos found in linked workspaces that are not watched yet.
  const suggestions = $derived(
    [
      ...new Set(
        Object.values($reposByWorkspace).flatMap((rs) =>
          rs.flatMap((r) => (r.slug ? [r.slug] : [])),
        ),
      ),
    ].filter((slug) => !$watchedRepos.includes(slug)),
  );

  const validateRepo = (v: string) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? null : "Use the form owner/name");

  /**
   * The workspace a repo card belongs to, for its colour dot and name. The
   * session itself starts in the repo's own directory, not here — see
   * `workOnPr`.
   */
  function workspaceFor(repo: string) {
    const match = matchRepo($reposByWorkspace, repo);
    if (!match) return null;
    return $visibleWorkspaces.find((w) => w.path === match.workspacePath) ?? null;
  }

  /* A refresh that just landed reads "just now" for half a minute rather than
     flicking straight to "1m ago". */
  function updatedLabel(updated: number | null, ref: number): string {
    if (updated == null) return "Not updated yet";
    return ref - updated < 30_000 ? "Updated just now" : `Updated ${formatAgo(updated, ref)}`;
  }
</script>

<div class="prs-view">
  <div class="toolbar">
    <SegmentedControl
      options={filterOptions}
      value={activeFilter}
      role="radiogroup"
      label="Filter pull requests"
      onChange={(id) => prFilter.set(id)}
    />
    <div class="search">
      <SearchInput bind:value={query} placeholder="Search title, author, branch" aria-label="Search pull requests" />
    </div>
    <Select
      size="sm"
      aria-label="Sort pull requests"
      options={SORT_OPTIONS}
      value={sort}
      onChange={(id) => (sort = id as PrSort)}
    />
    <div class="spacer"></div>
    <span class="meta" use:tooltip={{ text: `Refreshes every ${$prRefreshMinutes} minutes` }}>
      {$prsLoading ? "Updating" : updatedLabel($prsLastUpdated, now)}
    </span>
    <Button size="sm" loading={$prsLoading} onclick={() => refreshPrs()}>
      {#snippet leading()}<Icon name="refresh" size={16} />{/snippet}
      Refresh
    </Button>
    <Button size="sm" onclick={() => openSettings("connectors")}>Watched repos</Button>
  </div>

  <div class="cards">
    {#if setup}
      <EmptyState
        icon={rateLimit ? "warning" : "error"}
        title={setup.title}
        description={rateLimit ? `${setup.detail} ${retryLabel(rateLimit.retryAt, now)}` : setup.detail}
      >
        {#snippet action()}
          {#if setup.action === "connect" || setup.action === "reconnect"}
            <Button variant="primary" onclick={() => openSettings("connectors")}>Open connectors</Button>
          {:else if setup.action === "retry"}
            <Button onclick={() => refreshPrs()}>Retry</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else if $effectiveWatchedRepos.length === 0}
      <EmptyState
        icon="info"
        title="No repositories watched yet"
        description="Add the repositories whose open pull requests you want here"
      >
        {#snippet action()}
          <div class="add">
            <ChipInput
              label="Watched repositories"
              placeholder="owner/name"
              value={$watchedRepos}
              validate={validateRepo}
              onChange={(v) => void setWatchedRepos(v)}
            />
            {#if suggestions.length > 0}
              <div class="suggest" role="group" aria-label="Repositories in your workspaces">
                {#each suggestions as slug (slug)}
                  <Button size="sm" onclick={() => void setWatchedRepos([...$watchedRepos, slug])}>
                    Add {slug}
                  </Button>
                {/each}
              </div>
            {/if}
          </div>
        {/snippet}
      </EmptyState>
    {:else if $prRepos === null}
      <div class="card" aria-busy="true" aria-label="Loading pull requests">
        {#each [0, 1, 2] as i (i)}
          <div class="skel-row">
            <Skeleton width="60%" height="var(--sp-4)" />
            <Skeleton width="35%" height="var(--sp-4)" />
          </div>
        {/each}
      </div>
    {:else if cards.length === 0}
      {#if activeFilter === "all" && !query.trim()}
        <EmptyState icon="info" title="No open pull requests" description="Nothing is open in the watched repositories" />
      {:else}
        <EmptyState icon="info" title="Nothing matches" description="Try another filter or search" />
      {/if}
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
              <Button size="sm" variant="link" onclick={() => openSettings("connectors")}>
                Link a workspace to start sessions from PRs
              </Button>
            {/if}
          </header>

          {#if card.error}
            <Banner tone={card.error.kind === "connectorRateLimited" ? "warn" : "error"} title={card.error.message}>
              {#if card.error.kind === "connectorRateLimited"}
                {retryLabel(card.error.retryAt ?? 0, now)}
              {/if}
              {#snippet actions()}
                <Button size="sm" onclick={() => refreshPrs()}>Retry</Button>
              {/snippet}
            </Banner>
          {/if}

          {#each card.prs as pr (pr.number)}
            <PrRow repo={card.repo} {pr} {now} {providerName} />
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
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5) 0;
  }

  .search {
    width: 240px;
  }

  .spacer {
    flex: 1;
  }

  .meta {
    color: var(--muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-5) var(--sp-5);
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    width: min(420px, 100%);
  }

  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .skel-row {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-4);
    border-bottom: 1px solid var(--border);
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
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--border);
  }

  .ws-dot {
    flex-shrink: 0;
    width: var(--sp-3);
    height: var(--sp-3);
    border-radius: var(--r-xs);
  }

  .repo {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .open-count {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .linked {
    color: var(--muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .linked-name {
    color: var(--text);
  }
</style>
