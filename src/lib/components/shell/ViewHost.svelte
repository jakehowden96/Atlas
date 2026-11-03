<script lang="ts">
  import ErrorBoundary from "../ui/ErrorBoundary.svelte";
  import FilesView from "../files/FilesView.svelte";
  import PrsView from "../prs/PrsView.svelte";
  import SessionView from "../session/SessionView.svelte";
  import SessionsView from "../sessions/SessionsView.svelte";
  import StatsView from "../stats/StatsView.svelte";
  import { firstRunDismissed } from "../../stores/settings";
  import { activeView } from "../../stores/view";
  import { visibleWorkspaces } from "../../stores/workspace";
  import FirstRun from "./FirstRun.svelte";

  // Latched once a fresh profile is seen, so the checklist stays up as items
  // complete (adding the workspace must not hide it) until done or skipped.
  let firstRun = $state(false);
  $effect(() => {
    if (!$firstRunDismissed && $visibleWorkspaces.length === 0) firstRun = true;
    else if ($firstRunDismissed) firstRun = false;
  });
</script>

<div class="view-host">
  <!-- Sessions stays mounted too: rebuilding the grid from scratch on every
       return was the visible delay coming back from a session. -->
  <div class="view" class:hidden={$activeView !== "sessions"}>
    {#if firstRun}
      <FirstRun />
    {:else}
      <ErrorBoundary name="Sessions"><SessionsView /></ErrorBoundary>
    {/if}
  </div>
  {#if $activeView === "files"}
    <div class="view"><ErrorBoundary name="Files"><FilesView /></ErrorBoundary></div>
  {:else if $activeView === "prs"}
    <div class="view"><ErrorBoundary name="Pull requests"><PrsView /></ErrorBoundary></div>
  {:else if $activeView === "stats"}
    <div class="view"><ErrorBoundary name="Stats"><StatsView /></ErrorBoundary></div>
  {/if}

  <!-- Session stays mounted: an xterm instance cannot survive a remount, so
       hiding it is the only way to keep PTYs alive across view switches. -->
  <div class="view" class:hidden={$activeView !== "session"}>
    <ErrorBoundary name="Session"><SessionView /></ErrorBoundary>
  </div>
</div>

<style>
  .view-host {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    animation: atlasFadeIn 0.18s ease;
  }

  /* display:none also restarts atlasFadeIn when the pane comes back. */
  .view.hidden {
    display: none;
  }
</style>
