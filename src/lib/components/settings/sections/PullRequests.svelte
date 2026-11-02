<script lang="ts">
  import "./shared.css";
  import { enterLabel } from "../../../platform";
  import { prViewer } from "../../../stores/prs";
  import {
    autoAddReposFromWorkspaces,
    PR_REFRESH_CHOICES,
    prRefreshMinutes,
    setAutoAddReposFromWorkspaces,
    setPrRefreshMinutes,
    setWatchedRepos,
    watchedRepos,
  } from "../../../stores/settings";
  import SegmentedControl, { type Segment } from "../../ui/SegmentedControl.svelte";
  import Toggle from "../../ui/Toggle.svelte";

  const REFRESH: Segment[] = [
    { id: "1", label: "1m" },
    { id: "3", label: "3m" },
    { id: "10", label: "10m" },
  ];

  let repoDraft = $state("");

  function addRepo() {
    const slug = repoDraft.trim();
    // `owner/repo` is what `gh` takes; anything else would just 404 per repo.
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug) || $watchedRepos.includes(slug)) return;
    void setWatchedRepos([...$watchedRepos, slug]);
    repoDraft = "";
  }

  function removeRepo(slug: string) {
    void setWatchedRepos($watchedRepos.filter((r) => r !== slug));
  }

  function onRepoKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addRepo();
  }
</script>

<div class="stack sec">
  <p class="copy">
    Repos listed on the Pull requests tab. Uses <code>gh</code>, which must be installed and signed
    in.
    {#if $prViewer}
      <span class="ok">gh auth status: ok · @{$prViewer.login}</span>
    {:else}
      <span class="bad">gh auth status: not authenticated</span>
    {/if}
  </p>

  <div class="chips">
    {#each $watchedRepos as repo (repo)}
      <span class="chip">
        {repo}
        <button
          type="button"
          class="chip-x"
          aria-label="Stop watching {repo}"
          onclick={() => removeRepo(repo)}>✕</button
        >
      </span>
    {/each}
    <input
      class="chip-input"
      placeholder={`owner/repo ${enterLabel()}`}
      spellcheck="false"
      bind:value={repoDraft}
      onkeydown={onRepoKeydown}
    />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Auto-add repos from workspaces</div>
      <div class="row-desc">
        Any workspace with a GitHub remote is watched automatically. Your own entries above are kept
        separately, so turning this off leaves them alone.
      </div>
    </div>
    <Toggle
      checked={$autoAddReposFromWorkspaces}
      label="Auto-add repos from workspaces"
      onChange={(v) => void setAutoAddReposFromWorkspaces(v)}
    />
  </div>

  <div class="row">
    <div class="row-text"><div class="row-title">Refresh interval</div></div>
    <SegmentedControl
      options={REFRESH}
      value={String($prRefreshMinutes)}
      size="sm"
      onChange={(id) => {
        const minutes = PR_REFRESH_CHOICES.find((m) => String(m) === id);
        if (minutes) void setPrRefreshMinutes(minutes);
      }}
    />
  </div>
</div>

<style>
  /* ── Watched-repo chips ────────────────────────────────────────────────── */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--surface2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .chip-x {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .chip-x:hover {
    color: var(--danger);
  }

  .chip-input {
    width: 140px;
    height: 26px;
    padding: 0 10px;
    border: 1px dashed var(--border2);
    border-radius: 13px;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    outline: none;
  }

  /* Replaces the outline above: the dashed "add one" border goes solid accent
     while the box is being typed in. */
  .chip-input:focus-visible {
    border-style: solid;
    border-color: var(--accent);
  }
</style>
