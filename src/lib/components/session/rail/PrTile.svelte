<script lang="ts">
  import { onMount } from "svelte";
  import { connectors } from "../../../stores/connectors";
  import {
    loadWorkspaceRepos,
    prRepos,
    refreshPrsForBranch,
    reposByWorkspace,
    type Pr,
  } from "../../../stores/prs";
  import { settingsOpen } from "../../../stores/settings";
  import { setupProblem } from "../../../pr-setup";
  import { formatAgo } from "../../../format";
  import { prHeadline, prOpenHeadline, prPollLine, prRows, prState } from "../../../session-view";
  import Skeleton from "../../ui/Skeleton.svelte";
  import RailGroup from "./RailGroup.svelte";
  import Tile from "./Tile.svelte";

  interface Props {
    workspacePath: string | undefined;
    branch: string;
    /** `Date.now()`, ticked once a second by the view. */
    now: number;
  }

  let { workspacePath, branch, now }: Props = $props();

  const POLL_MS = 60_000;

  onMount(() => {
    if (workspacePath) void loadWorkspaceRepos([workspacePath]);
  });

  let slug = $derived.by(() => {
    const repos = workspacePath ? ($reposByWorkspace[workspacePath] ?? []) : [];
    return (repos.find((r) => r.path === workspacePath) ?? repos[0])?.slug ?? null;
  });
  let prConnector = $derived($connectors.find((c) => c.info.kind === "pullRequests"));
  let provider = $derived(prConnector?.info.name ?? "the pull request service");
  let problem = $derived(setupProblem($connectors, $prRepos));
  let linked = $derived(prConnector?.status.kind === "linked");

  let entry = $derived(
    slug ? ($prRepos?.find((r) => r.repo.toLowerCase() === slug.toLowerCase()) ?? null) : null,
  );
  let fresh = $derived(entry?.prs.find((p) => p.headRefName === branch) ?? null);

  // The last good answer outlives a failed refresh, so the tile can dim it
  // instead of going blank.
  let lastGood = $state<Pr | null>(null);
  let lastOk = $state<number | null>(null);
  $effect(() => {
    if (entry && !entry.error) {
      lastGood = fresh;
      lastOk = Date.now();
    }
  });
  // A different branch's PR is not a stale answer for this one.
  $effect.pre(() => {
    void branch;
    lastGood = null;
    lastOk = null;
  });

  let stale = $derived(!!entry?.error && lastGood !== null);
  let pr = $derived(stale ? lastGood : fresh);

  let docHidden = $state(typeof document !== "undefined" && document.hidden);
  // Polls only while mounted (the rail is wide and the session view is
  // showing) and the window is visible; the store never doubles a request.
  $effect(() => {
    if (!slug || !linked || docHidden) return;
    const repo = slug;
    const run = () => void refreshPrsForBranch(repo, branch);
    run();
    const timer = setInterval(run, POLL_MS);
    return () => clearInterval(timer);
  });

  function retry() {
    if (slug) void refreshPrsForBranch(slug, branch);
  }

  let tileState = $derived(prState(pr, stale));
  let rows = $derived(pr ? prRows(pr, provider) : null);
  let loading = $derived(!problem && slug !== null && linked && entry === null);
  let rateLimited = $derived(problem?.kind === "rateLimited" ? problem : null);
  let ago = $derived(lastOk === null ? "" : formatAgo(lastOk, now));
  let retryTime = $derived(
    rateLimited
      ? new Date(rateLimited.retryAt * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
  );
</script>

<svelte:document onvisibilitychange={() => (docHidden = document.hidden)} />

{#snippet setupLink()}
  {#if problem?.kind === "noConnector"}
    <button type="button" class="link" onclick={() => settingsOpen.set(true)}>Link {provider} →</button>
  {:else if problem?.kind === "reconnect"}
    <button type="button" class="link" onclick={() => settingsOpen.set(true)}>Reconnect {provider} →</button>
  {/if}
{/snippet}

{#snippet staleLine()}
  <span class="warn mono">couldn't refresh · {ago} · </span><button
    type="button"
    class="link warn mono"
    onclick={retry}>Retry</button
  >
{/snippet}

<Tile key="pr" label="PR" state={tileState}>
  {#snippet headline(open: boolean)}
    {#if problem?.kind === "noConnector"}
      <span class="muted">No pull request service linked</span>
    {:else if problem?.kind === "reconnect"}
      <span class="muted">Sign-in expired</span>
    {:else if rateLimited}
      <span class="muted">Rate limited, retrying at {retryTime}</span>
    {:else if loading}
      <Skeleton width="60%" />
    {:else if !pr}
      <span class="muted">No PR for this branch yet</span>
    {:else if open}
      {@const p = prOpenHeadline(pr)}
      <span class="phrase {p.tone} strong">{p.text}</span>
    {:else}
      {#each prHeadline(pr) as p, i (i)}{#if i > 0}<span class="muted">, </span>{/if}<span
          class="phrase {p.tone}"
          class:strong={p.strong}>{p.text}</span
        >{/each}
    {/if}
  {/snippet}
  {#snippet detail()}
    {#if problem?.kind === "noConnector" || problem?.kind === "reconnect"}
      {@render setupLink()}
    {:else if pr}
      <span class:dim={stale}>{pr.title}</span>
      {#if stale && lastOk !== null}{@render staleLine()}{/if}
    {/if}
  {/snippet}
  {#snippet children()}
    {#if problem?.kind === "noConnector" || problem?.kind === "reconnect"}
      {@render setupLink()}
    {:else if pr && rows}
      <div class="stack" class:dim={stale}>
        <div class="title">{pr.title}</div>
        {#if lastOk !== null}
          <div class="poll mono" class:warn={stale}>
            {prPollLine(now, lastOk, stale ? provider : null)}
          </div>
        {/if}
        <RailGroup rows={rows.running} noun="running" />
        <RailGroup rows={rows.attention} noun="failing" />
        <RailGroup rows={rows.other} />
        <RailGroup rows={rows.done} fold="passed" />
      </div>
      {#if stale}<div>{@render staleLine()}</div>{/if}
    {:else if entry?.error && !rateLimited}
      <div>
        <span class="warn mono">couldn't load · </span><button
          type="button"
          class="link warn mono"
          onclick={retry}>Retry</button
        >
      </div>
    {/if}
  {/snippet}
</Tile>

<style>
  .muted {
    color: var(--muted);
  }

  .phrase {
    white-space: nowrap;
  }

  .strong {
    font-weight: 500;
  }

  .accent {
    color: var(--accent);
  }

  .danger {
    color: var(--danger);
  }

  .warn {
    color: var(--warn);
  }

  .stack {
    display: grid;
    gap: 14px;
  }

  .dim {
    opacity: 0.6;
  }

  .title {
    font-size: var(--fs-sm);
    font-weight: 500;
    line-height: 20px;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }

  .poll {
    color: var(--muted);
  }

  .poll.warn {
    color: var(--warn);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  .link.mono {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    text-decoration: underline;
  }

  .link:hover {
    color: var(--text);
  }

  .link.warn:hover {
    color: var(--text);
  }
</style>
