<script lang="ts">
  import { onMount } from "svelte";
  import mermaid from "mermaid";
  import type { FlowData } from "../../../types/panel";
  import { flowEdgesToMermaid } from "../../mermaid-converter";
  import { mermaidThemeVariables } from "../../theme";

  interface Props {
    data: FlowData | undefined;
    hasDiff?: boolean;
  }

  let { data, hasDiff = false }: Props = $props();
  let diagramEl: HTMLDivElement = $state(null!);
  let renderCount = 0;

  onMount(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      themeVariables: mermaidThemeVariables,
    });
  });

  $effect(() => {
    if (data && diagramEl) {
      const mermaidSyntax = data.mermaid || flowEdgesToMermaid(data.edges);
      renderCount++;
      const id = `flow-${renderCount}`;

      mermaid
        .render(id, mermaidSyntax)
        .then(({ svg }) => {
          diagramEl.innerHTML = svg;
        })
        .catch((err) => {
          diagramEl.innerHTML = `<div class="error">Failed to render diagram: ${err.message}</div>`;
        });
    }
  });
</script>

<div class="flow-diagram">
  {#if data}
    <div class="diagram-container" bind:this={diagramEl}></div>
  {:else}
    <div class="empty">
      {#if hasDiff}
        <div class="loading">
          <span class="loading-dot"></span>
          Analyzing diff...
        </div>
      {:else}
        No diff to analyze
      {/if}
    </div>
  {/if}
</div>

<style>
  .flow-diagram {
    height: 100%;
    overflow: auto;
    padding: 16px;
  }

  .diagram-container {
    display: flex;
    justify-content: center;
    min-height: 200px;
  }

  .diagram-container :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--fg-muted);
    font-size: 14px;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--blue);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .diagram-container :global(.error) {
    color: var(--red);
    font-size: 13px;
    padding: 20px;
    text-align: center;
  }
</style>
