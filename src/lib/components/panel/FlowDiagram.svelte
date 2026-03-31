<script lang="ts">
  import { onMount } from "svelte";
  import mermaid from "mermaid";
  import type { FlowData } from "../../../types/panel";
  import { flowEdgesToMermaid } from "../../mermaid-converter";

  interface Props {
    data: FlowData | undefined;
  }

  let { data }: Props = $props();
  let diagramEl: HTMLDivElement;
  let renderCount = $state(0);

  onMount(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      themeVariables: {
        darkMode: true,
        primaryColor: "#7aa2f7",
        primaryTextColor: "#a9b1d6",
        primaryBorderColor: "#3b4261",
        lineColor: "#444b6a",
        secondaryColor: "#1e2030",
        tertiaryColor: "#292d3e",
        background: "#1a1b26",
        mainBkg: "#1e2030",
        nodeBorder: "#3b4261",
        clusterBkg: "#13141c",
        fontSize: "13px",
      },
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
    <div class="empty">No flow diagram available</div>
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
    color: #787c99;
    font-size: 14px;
  }

  .diagram-container :global(.error) {
    color: #f7768e;
    font-size: 13px;
    padding: 20px;
    text-align: center;
  }
</style>
