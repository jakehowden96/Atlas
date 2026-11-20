<script lang="ts">
  import "./shared.css";
  import {
    autoAddReposFromWorkspaces,
    PR_REFRESH_CHOICES,
    prRefreshMinutes,
    setAutoAddReposFromWorkspaces,
    setPrRefreshMinutes,
    setWatchedRepos,
    validateRepo,
    watchedRepos,
  } from "../../../stores/settings";
  import ChipInput from "../../app/common/ChipInput.svelte";
  import Segmented, { type Segment } from "$lib/components/app/common/Segmented.svelte";
  import { Switch } from "$lib/components/ui/switch/index.js";

  const REFRESH: Segment[] = PR_REFRESH_CHOICES.map((m) => ({ id: String(m), label: `${m}m` }));
</script>

<div class="rows sec">
  <div class="field">
    <div class="row-text">
      <div class="row-title">Watched repositories</div>
      <div class="row-desc">
        Repositories whose open pull requests Atlas lists. Kept when you disconnect or reconnect.
      </div>
    </div>
    <ChipInput
      label="Watched repositories"
      placeholder="owner/name"
      value={$watchedRepos}
      validate={validateRepo}
      onChange={(v) => void setWatchedRepos(v)}
    />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Auto-add repos from workspaces</div>
      <div class="row-desc">Watch every workspace's GitHub remote.</div>
    </div>
    <Switch checked={$autoAddReposFromWorkspaces} onCheckedChange={(v) => void setAutoAddReposFromWorkspaces(v)} aria-label="Auto-add repos from workspaces" />
  </div>

  <div class="row">
    <div class="row-text">
      <div class="row-title">Refresh interval</div>
      <div class="row-desc">How often pull requests are re-polled.</div>
    </div>
    <Segmented
      options={REFRESH}
      value={String($prRefreshMinutes)}
      size="sm"
      role="radiogroup"
      label="Refresh interval"
      onChange={(id) => {
        const m = PR_REFRESH_CHOICES.find((c) => String(c) === id);
        if (m) void setPrRefreshMinutes(m);
      }}
    />
  </div>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
</style>
