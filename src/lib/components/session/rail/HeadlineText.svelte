<script lang="ts">
  import type { Headline } from "../../../session-view";

  let { h, restMuted = false }: { h: Headline; restMuted?: boolean } = $props();
</script>

{#if h.lead}<span class="lead {h.tone}">{h.lead}</span>{/if}<span
  class:muted={restMuted || h.tone === "muted"}>{h.rest}</span
>

<style>
  .lead {
    font-weight: 500;
  }

  .accent {
    color: var(--accent);
  }

  .muted {
    color: var(--muted);
  }
</style>
