<script lang="ts">
  import FilesView from "../files/FilesView.svelte";
  import PrsView from "../prs/PrsView.svelte";
  import SessionView from "../session/SessionView.svelte";
  import SessionsView from "../sessions/SessionsView.svelte";
  import StatsView from "../stats/StatsView.svelte";
  import { activeView } from "../../stores/view";
</script>

<div class="view-host">
  <!-- Sessions stays mounted too: rebuilding the grid from scratch on every
       return was the visible delay coming back from a session. -->
  <div class="view" class:hidden={$activeView !== "sessions"}>
    <SessionsView />
  </div>
  {#if $activeView === "files"}
    <div class="view"><FilesView /></div>
  {:else if $activeView === "prs"}
    <div class="view"><PrsView /></div>
  {:else if $activeView === "stats"}
    <div class="view"><StatsView /></div>
  {/if}

  <!-- Session stays mounted: an xterm instance cannot survive a remount, so
       hiding it is the only way to keep PTYs alive across view switches. -->
  <div class="view" class:hidden={$activeView !== "session"}>
    <SessionView />
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
