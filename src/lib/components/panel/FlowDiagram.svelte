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
    <!-- AI Suggestion Tag -->
    <div class="ai-tag">
      <span class="ai-tag-dot"></span>
      <span class="ai-tag-label">AI Suggestion</span>
    </div>

    <div class="diagram-container" bind:this={diagramEl}></div>

    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <button class="zoom-btn" title="Zoom In">
        <span class="material-symbols-outlined">zoom_in</span>
      </button>
      <span class="zoom-divider"></span>
      <button class="zoom-btn" title="Zoom Out">
        <span class="material-symbols-outlined">zoom_out</span>
      </button>
      <span class="zoom-divider"></span>
      <button class="zoom-btn" title="Center">
        <span class="material-symbols-outlined">center_focus_weak</span>
      </button>
    </div>
  {:else}
    <div class="empty">
      {#if hasDiff}
        <div class="loading">
          <span class="loading-dot"></span>
          Analyzing diff...
        </div>
      {:else}
        <span class="empty-text">No diff to analyze</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .flow-diagram {
    height: 100%;
    overflow: auto;
    position: relative;
    background-image: radial-gradient(var(--surface-container-high) 1px, transparent 1px);
    background-size: 24px 24px;
    background-color: var(--surface);
  }

  .ai-tag {
    position: absolute;
    top: 1rem;
    right: 1rem;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.75rem;
    background: color-mix(in srgb, var(--tertiary) 10%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--tertiary) 30%, transparent);
    border-radius: 9999px;
  }

  .ai-tag-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tertiary);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .ai-tag-label {
    font-size: 10px;
    font-family: var(--font-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--tertiary);
  }

  .diagram-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
    padding: 3rem var(--spacing-5);
  }

  .diagram-container :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .zoom-controls {
    position: absolute;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1.5rem;
    background: color-mix(in srgb, var(--surface-container-highest) 80%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 20%, transparent);
    border-radius: 9999px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }

  .zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s;
  }

  .zoom-btn:hover {
    color: var(--primary);
  }

  .zoom-btn :global(.material-symbols-outlined) {
    font-size: 1.15rem;
  }

  .zoom-divider {
    width: 1px;
    height: 1rem;
    background: color-mix(in srgb, var(--outline-variant) 40%, transparent);
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--on-surface-variant);
  }

  .empty-text {
    font-size: 22px;
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-family: var(--font-body);
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--primary-dim);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .diagram-container :global(.error) {
    color: var(--error);
    font-size: 13px;
    padding: 20px;
    text-align: center;
  }
</style>
