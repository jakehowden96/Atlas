<script lang="ts">
  import {
    autoAddReposFromWorkspaces,
    PR_REFRESH_CHOICES,
    prRefreshMinutes,
    setAutoAddReposFromWorkspaces,
    setPrRefreshMinutes,
    setWatchedRepos,
    watchedRepos,
  } from "../../../../stores/settings";
  import ChipInput from "../../../ui/ChipInput.svelte";
  import SegmentedControl, { type Segment } from "../../../ui/SegmentedControl.svelte";
  import Toggle from "../../../ui/Toggle.svelte";

  const REFRESH: Segment[] = PR_REFRESH_CHOICES.map((m) => ({ id: String(m), label: `${m}m` }));

  const validate = (v: string) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? null : "Use the form owner/name");
</script>

<div class="watched">
  <div class="title">Watched repositories</div>
  <ChipInput
    label="Watched repositories"
    placeholder="owner/name"
    value={$watchedRepos}
    {validate}
    onChange={(v) => void setWatchedRepos(v)}
  />
  {#if $watchedRepos.length > 0}
    <p class="hint" data-testid="kept-repos">
      Watched repositories are kept when you disconnect or reconnect
    </p>
  {/if}
  <div class="line">
    <span>Auto-add repositories from workspaces</span>
    <Toggle
      checked={$autoAddReposFromWorkspaces}
      label="Auto-add repositories from workspaces"
      onChange={(v) => void setAutoAddReposFromWorkspaces(v)}
    />
  </div>
  <div class="line">
    <span>Refresh interval</span>
    <SegmentedControl
      options={REFRESH}
      value={String($prRefreshMinutes)}
      size="sm"
      onChange={(id) => {
        const m = PR_REFRESH_CHOICES.find((c) => String(c) === id);
        if (m) void setPrRefreshMinutes(m);
      }}
    />
  </div>
</div>

<style>
  .watched {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding-left: calc(var(--sp-3) + 32px);
  }
  .title {
    font-size: var(--fs-sm);
    font-weight: 500;
  }
  .hint {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    font-size: var(--fs-sm);
  }
</style>
