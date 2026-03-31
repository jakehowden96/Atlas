<script lang="ts">
  import type { SummaryData } from "../../../types/panel";

  interface Props {
    data: SummaryData | undefined;
  }

  let { data }: Props = $props();

  function severityColor(severity: string): string {
    switch (severity) {
      case "error":
        return "#f7768e";
      case "warning":
        return "#e0af68";
      default:
        return "#7aa2f7";
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
    <div class="empty">No summary available</div>
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
    color: #787c99;
    margin: 0 0 8px 0;
  }

  .section-body {
    font-size: 13px;
    line-height: 1.6;
    color: #a9b1d6;
    margin: 0;
  }

  .confidence-bar {
    width: 100%;
    height: 4px;
    background: #292d3e;
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .confidence-fill {
    height: 100%;
    background: #9ece6a;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .confidence-label {
    font-size: 12px;
    color: #787c99;
  }

  .issues {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .issue {
    background: #1e2030;
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
    color: #7aa2f7;
    margin-left: 8px;
    font-family: monospace;
  }

  .issue-message {
    font-size: 13px;
    color: #a9b1d6;
    margin: 6px 0 0 0;
    line-height: 1.5;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #787c99;
    font-size: 14px;
  }
</style>
