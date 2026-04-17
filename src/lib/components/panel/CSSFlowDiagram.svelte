<script lang="ts">
  import type { FlowData } from "../../../types/panel";
  import RepositoryClean from "./RepositoryClean.svelte";
  import ActionButton from "./ActionButton.svelte";
  import { layoutFlowGraphChunked, extractFileColorMap, type ChunkedGraphLayout } from "../../css-graph-layout";
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

  let layout = $state.raw<ChunkedGraphLayout | null>(null);
  let viewportEl: HTMLDivElement = $state(null!);
  let fileColorMap = $state<Map<string, number>>(new Map());

  const PADDING = 24;
  const FILE_COLORS = [
    "#e6194B",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#42d4f4",
    "#f032e6",
    "#fabed4",
    "#469990",
    "#dcbeff",
    "#9A6324",
    "#fffac8",
    "#800000",
    "#aaffc3",
    "#000075",
    "#a9a9a9",
  ];

  $effect(() => {
    if (data && data.edges.length > 0) {
      const availableWidth = viewportEl
        ? viewportEl.clientWidth - PADDING * 2
        : 300;
      layout = layoutFlowGraphChunked(data.edges, availableWidth);
      fileColorMap = extractFileColorMap(data.edges);
    } else {
      layout = null;
      fileColorMap = new Map();
    }
  });

  function edgeToPath(points: { x: number; y: number }[]): string {
    if (points.length === 0) return "";
    if (points.length === 1) return `M${points[0].x},${points[0].y}`;

    let d = `M${points[0].x},${points[0].y}`;
    if (points.length === 2) {
      d += ` L${points[1].x},${points[1].y}`;
      return d;
    }

    // Smooth curve through intermediate points
    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const cpx2 = (curr.x + next.x) / 2;
      const cpy2 = (curr.y + next.y) / 2;
      if (i === 1) {
        d += ` Q${curr.x},${curr.y} ${cpx2},${cpy2}`;
      } else {
        d += ` T${cpx2},${cpy2}`;
      }
    }
    const last = points[points.length - 1];
    d += ` L${last.x},${last.y}`;
    return d;
  }

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
        await refreshPanel(get(activeTabId), cwd);
      }
    } catch (e) {
      showToast(`Failed to save API key: ${e}`);
    } finally {
      saving = false;
    }
  }

  async function handleRetry() {
    const tabId = get(activeTabId);
    try {
      await resetAnalysis(tabId);
    } catch (e) {
      showToast(`Reset failed: ${e}`);
    }
    analysisStatus.set("idle");
    analysisError.set(null);
    const cwd = get(panelData)?.cwd;
    if (cwd) {
      try {
        await refreshPanel(tabId, cwd);
      } catch (e) {
        showToast(`Refresh failed: ${e}`);
      }
    }
  }

  function parseSymbol(label: string): string {
    const sep = label.indexOf("::");
    return sep > 0 ? label.slice(sep + 2) : label;
  }

  function getFileName(nodeId: string): string {
    const sep = nodeId.indexOf("::");
    return sep > 0 ? nodeId.slice(0, sep) : "";
  }

  function getFileColor(nodeId: string): string {
    const file = getFileName(nodeId);
    const idx = fileColorMap.get(file) ?? 0;
    return FILE_COLORS[idx % FILE_COLORS.length];
  }
</script>

<div class="flow-diagram">
  {#if layout && layout.chunks.length > 0}
    <div class="diagram-viewport" bind:this={viewportEl}>
      {#each layout.chunks as chunk, chunkIdx (chunkIdx)}
        <div class="diagram-chunk">
          <div
            class="diagram-stage"
            style="width: {chunk.width}px; height: {chunk.height}px"
          >
            <!-- SVG edge layer -->
            <svg class="edge-layer" viewBox="0 0 {chunk.width} {chunk.height}">
              <defs>
                <marker
                  id="arrowhead-{chunkIdx}"
                  markerWidth="8"
                  markerHeight="6"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="var(--outline-variant)" />
                </marker>
              </defs>
              {#each chunk.edges as edge (edge.id)}
                <path
                  d={edgeToPath(edge.points)}
                  class="edge-path {edge.edge_type && /^[a-z_]+$/.test(edge.edge_type) ? 'edge-' + edge.edge_type : ''}"
                  marker-end="url(#arrowhead-{chunkIdx})"
                />
              {/each}
            </svg>

            <!-- Node layer -->
            {#each chunk.nodes as node (node.id)}
              <div
                class="graph-node"
                class:node-changed={data?.changed_nodes?.includes(node.id)}
                style="left: {node.x}px; top: {node.y}px; width: {node.width}px; height: {node.height}px; border-left: 3px solid {getFileColor(node.id)}"
              >
                <span class="node-file" style="color: {getFileColor(node.id)}">{getFileName(node.label)}</span>
                <span class="node-label">{parseSymbol(node.label)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
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
            <ActionButton
              label="Save"
              loadingLabel="Saving..."
              variant="primary"
              loading={saving}
              disabled={!apiKeyInput.trim()}
              onclick={handleSaveKey}
            />
          </div>
        </div>
      {:else if hasDiff && $analysisStatus === "error"}
        <div class="error-state">
          <span class="material-symbols-outlined error-icon">error</span>
          <p class="error-title">Analysis Failed</p>
          <p class="error-message">{$analysisError ?? "Unknown error"}</p>
          <ActionButton
            label="Retry"
            icon="refresh"
            variant="surface"
            onclick={handleRetry}
          />
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
    position: relative;
    background-color: var(--surface);
    background-image: radial-gradient(var(--surface-container-high) 1px, transparent 1px);
    background-size: 24px 24px;
  }

  .diagram-viewport {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 24px;
    box-sizing: border-box;
  }

  .diagram-chunk {
    margin-bottom: 24px;
  }

  .diagram-chunk:last-child {
    margin-bottom: 0;
  }

  .diagram-stage {
    position: relative;
    margin: 0 auto;
  }

  /* ── SVG edges ── */
  .edge-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .edge-path {
    fill: none;
    stroke: var(--outline-variant);
    stroke-width: 2;
    opacity: 0.5;
  }

  .edge-calls {
    stroke: var(--primary-dim);
    opacity: 0.7;
  }

  .edge-depends_on {
    stroke-dasharray: 6 4;
    opacity: 0.35;
  }

  .edge-consumed_by {
    stroke: var(--secondary);
    opacity: 0.6;
  }

  .edge-modifies {
    stroke: var(--error);
    opacity: 0.5;
  }

  /* ── Nodes ── */
  .graph-node {
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4px 10px;
    background: var(--surface-container-high);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    border-radius: var(--radius);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
    z-index: 1;
  }

  .graph-node:hover {
    border-color: var(--primary);
    box-shadow:
      0 4px 20px rgba(0, 0, 0, 0.3),
      0 0 20px color-mix(in srgb, var(--primary) 15%, transparent);
  }

  .node-changed {
    background: color-mix(in srgb, var(--primary) 12%, var(--surface-container-high));
    box-shadow:
      0 4px 20px rgba(0, 0, 0, 0.3),
      0 0 12px color-mix(in srgb, var(--primary) 20%, transparent);
    border-color: color-mix(in srgb, var(--primary) 40%, var(--outline-variant));
  }

  .node-file {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 6px);
    line-height: 1.2;
  }

  .node-label {
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 700;
    color: var(--on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 6px);
  }

  /* ── Empty / error / loading states ── */
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--on-surface-variant);
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
</style>
