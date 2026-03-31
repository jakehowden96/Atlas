<script lang="ts">
  import type { SummaryData } from "../../../types/panel";

  interface Props {
    data: SummaryData | undefined;
    hasDiff?: boolean;
  }

  let { data, hasDiff = false }: Props = $props();

  function severityColor(severity: string): string {
    switch (severity) {
      case "error":
        return "var(--red)";
      case "warning":
        return "var(--yellow)";
      default:
        return "var(--blue)";
    }
  }
</script>

<div class="summary-view">
  {#if data}
    <div class="section">
      <h3 class="section-title">Summary</h3>
      <p class="section-body">{data.summary}</p>
    </div>

    <div class="section">
      <h3 class="section-title">How</h3>
      <p class="section-body">{data.fix}</p>
    </div>

    <div class="section">
      <h3 class="section-title">Why</h3>
      <p class="section-body">{data.why}</p>
    </div>

    {#if data.confidence !== undefined}
      <div class="section">
        <h3 class="section-title">Confidence</h3>
        <div class="confidence-bar">
          <div
            class="confidence-fill"
            style="width: {data.confidence * 100}%"
          ></div>
        </div>
        <span class="confidence-label"
          >{Math.round(data.confidence * 100)}%</span
        >
      </div>
    {/if}

    {#if data.issues && data.issues.length > 0}
      <div class="section">
        <h3 class="section-title">Issues ({data.issues.length})</h3>
        <div class="issues">
          {#each data.issues as issue}
            <div class="issue">
              <span
                class="issue-severity"
                style="color: {severityColor(issue.severity)}"
              >
                {issue.severity}
              </span>
              <span class="issue-location">{issue.file}:{issue.line}</span>
              <p class="issue-message">{issue.message}</p>
            </div>
          {/each}
        </div>
      </div>
    {/if}
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
  .summary-view {
    height: 100%;
    overflow: auto;
    padding: 16px;
  }

  .section {
    margin-bottom: 20px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-muted);
    margin: 0 0 8px 0;
  }

  .section-body {
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg);
    margin: 0;
  }

  .confidence-bar {
    width: 100%;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .confidence-fill {
    height: 100%;
    background: var(--green);
    border-radius: 2px;
    transition: width 0.3s;
  }

  .confidence-label {
    font-size: 12px;
    color: var(--fg-muted);
  }

  .issues {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .issue {
    background: var(--bg-light);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .issue-severity {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .issue-location {
    font-size: 11px;
    color: var(--blue);
    margin-left: 8px;
    font-family: monospace;
  }

  .issue-message {
    font-size: 13px;
    color: var(--fg);
    margin: 6px 0 0 0;
    line-height: 1.5;
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
</style>
