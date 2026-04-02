<script lang="ts">
  import { onMount } from "svelte";
  import mermaid from "mermaid";
  import type { FlowData } from "../../../types/panel";
  import RepositoryClean from "./RepositoryClean.svelte";
  import { flowEdgesToMermaid } from "../../mermaid-converter";
  import { mermaidThemeVariables } from "../../theme";
  import { apiKeyConfigured, checkApiStatus, panelData, analysisStatus, analysisError } from "../../stores/panel";
  import { setApiKey, refreshPanel, resetAnalysis } from "../../ipc";
  import { activeTabId } from "../../stores/terminal";
  import { showToast } from "../../stores/toast";
  import { get } from "svelte/store";

  interface Props {
    data: FlowData | undefined;
    hasDiff?: boolean;
  }

  let { data, hasDiff = false }: Props = $props();
  let apiKeyInput = $state("");
  let saving = $state(false);

  async function handleSaveKey() {
    if (!apiKeyInput.trim()) return;
    saving = true;
    try {
      await setApiKey(apiKeyInput.trim());
      await checkApiStatus();
      apiKeyInput = "";
      showToast("API key saved");
      const cwd = get(panelData)?.cwd;
      if (cwd) {
        refreshPanel(get(activeTabId), cwd);
      }
    } catch (e) {
      showToast(`Failed to save API key: ${e}`);
    } finally {
      saving = false;
    }
  }
  async function handleRetry() {
    const tabId = get(activeTabId);
    await resetAnalysis(tabId);
    analysisStatus.set("idle");
    analysisError.set(null);
    const cwd = get(panelData)?.cwd;
    if (cwd) {
      refreshPanel(tabId, cwd);
    }
  }

  let diagramEl: HTMLDivElement = $state(null!);
  let containerEl: HTMLDivElement = $state(null!);
  let renderCount = 0;
  let lastRenderedSyntax = "";

  let scale = $state(1);
  let translateX = $state(0);
  let translateY = $state(0);

  // Pan state
  let isPanning = $state(false);
  let panStartX = 0;
  let panStartY = 0;
  let panStartTransX = 0;
  let panStartTransY = 0;

  function zoomIn() {
    scale = Math.min(scale * 1.25, 5);
  }

  function zoomOut() {
    scale = Math.max(scale / 1.25, 0.2);
  }

  function resetView() {
    scale = 1;
    translateX = 0;
    translateY = 0;
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      scale = Math.min(Math.max(scale * delta, 0.2), 5);
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartTransX = translateX;
    panStartTransY = translateY;
    containerEl.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPanning) return;
    // Divide by scale because translate operates in the zoomed coordinate space
    translateX = panStartTransX + (e.clientX - panStartX) / scale;
    translateY = panStartTransY + (e.clientY - panStartY) / scale;
  }

  function handlePointerUp() {
    isPanning = false;
  }

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
      if (mermaidSyntax === lastRenderedSyntax) return;
      lastRenderedSyntax = mermaidSyntax;
      renderCount++;
      const id = `flow-${renderCount}`;

      // mermaid.render returns sanitized SVG from its own syntax — safe to inject
      mermaid
        .render(id, mermaidSyntax)
        .then(({ svg }) => {
          diagramEl.innerHTML = svg;
        })
        .catch((err) => {
          diagramEl.textContent = `Failed to render diagram: ${err.message}`;
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

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="diagram-viewport"
      bind:this={containerEl}
      onwheel={handleWheel}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      style="cursor: {isPanning ? 'grabbing' : 'grab'}"
    >
      <div
        class="diagram-container"
        bind:this={diagramEl}
        style="transform: translate({translateX}px, {translateY}px); zoom: {scale}"
      ></div>
    </div>

    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <button class="zoom-btn" title="Zoom In" onclick={zoomIn}>
        <span class="material-symbols-outlined">zoom_in</span>
      </button>
      <span class="zoom-divider"></span>
      <button class="zoom-btn" title="Zoom Out" onclick={zoomOut}>
        <span class="material-symbols-outlined">zoom_out</span>
      </button>
      <span class="zoom-divider"></span>
      <button class="zoom-btn" title="Center" onclick={resetView}>
        <span class="material-symbols-outlined">center_focus_weak</span>
      </button>
    </div>
  {:else}
    <div class="empty">
      {#if hasDiff && !$apiKeyConfigured}
        <div class="api-key-prompt">
          <span class="material-symbols-outlined key-icon">key</span>
          <p class="key-title">API Key Required</p>
          <p class="key-desc">Enter your Anthropic API key to enable AI analysis.</p>
          <div class="key-input-row">
            <input
              type="password"
              class="key-input"
              placeholder="sk-ant-..."
              bind:value={apiKeyInput}
              onkeydown={(e) => { if (e.key === "Enter") handleSaveKey(); }}
            />
            <button class="key-save-btn" onclick={handleSaveKey} disabled={saving || !apiKeyInput.trim()}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      {:else if hasDiff && $analysisStatus === "error"}
        <div class="error-state">
          <span class="material-symbols-outlined error-icon">error</span>
          <p class="error-title">Analysis Failed</p>
          <p class="error-message">{$analysisError ?? "Unknown error"}</p>
          <button class="retry-btn" onclick={handleRetry}>
            <span class="material-symbols-outlined retry-icon">refresh</span>
            Retry
          </button>
        </div>
      {:else if hasDiff}
        <div class="loading">
          <span class="loading-dot"></span>
          Analyzing diff...
        </div>
      {:else}
        <RepositoryClean />
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

  .diagram-viewport {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    touch-action: none;
  }

  .diagram-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
    padding: 3rem var(--spacing-5);
    transform-origin: center center;
  }

  .diagram-container :global(svg) {
    pointer-events: none;
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

  .api-key-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    max-width: 320px;
    text-align: center;
  }

  .key-icon {
    font-size: 2rem;
    color: var(--on-surface-variant);
    font-variation-settings: 'FILL' 0;
  }

  .key-title {
    margin: 0;
    font-size: 1rem;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--on-surface);
  }

  .key-desc {
    margin: 0;
    font-size: 0.8rem;
    color: var(--on-surface-variant);
    line-height: 1.5;
  }

  .key-input-row {
    display: flex;
    gap: 0.5rem;
    width: 100%;
  }

  .key-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--surface-container-high);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    color: var(--on-surface);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }

  .key-input:focus {
    border-color: var(--primary);
  }

  .key-save-btn {
    padding: 0.5rem 1rem;
    background: var(--primary);
    color: var(--on-primary);
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }

  .key-save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .key-save-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    max-width: 320px;
    text-align: center;
  }

  .error-icon {
    font-size: 2rem;
    color: var(--error);
    font-variation-settings: 'FILL' 0;
  }

  .error-title {
    margin: 0;
    font-size: 1rem;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--on-surface);
  }

  .error-message {
    margin: 0;
    font-size: 0.75rem;
    color: var(--on-surface-variant);
    line-height: 1.5;
    font-family: var(--font-mono);
    word-break: break-word;
  }

  .retry-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    background: var(--surface-container-high);
    color: var(--on-surface);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-sm);
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: var(--surface-bright);
  }

  .retry-icon {
    font-size: 0.9rem;
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
