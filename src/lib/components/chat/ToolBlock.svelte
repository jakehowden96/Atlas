<script lang="ts">
  import type { ToolCall } from "../../stores/chat";

  interface Props {
    call: ToolCall;
  }

  let { call }: Props = $props();
  let expanded = $state(false);

  const TOOL_ICONS: Record<string, { icon: string; cls: string }> = {
    Read: { icon: "description", cls: "read" },
    Glob: { icon: "search", cls: "search" },
    Grep: { icon: "search", cls: "search" },
    Edit: { icon: "edit_note", cls: "edit" },
    Write: { icon: "edit_note", cls: "edit" },
    Bash: { icon: "terminal", cls: "terminal" },
    WebSearch: { icon: "language", cls: "search" },
    WebFetch: { icon: "language", cls: "search" },
    Agent: { icon: "smart_toy", cls: "search" },
  };

  let iconInfo = $derived(TOOL_ICONS[call.toolName] ?? { icon: "build", cls: "" });

  function toolLabel(): string {
    const input = call.input;
    if (call.toolName === "Read" && input.file_path) return `Read ${input.file_path}`;
    if (call.toolName === "Edit" && input.file_path) return `Edit ${input.file_path}`;
    if (call.toolName === "Write" && input.file_path) return `Write ${input.file_path}`;
    if (call.toolName === "Bash" && input.command) return `${input.command}`;
    if (call.toolName === "Glob" && input.pattern) return `Glob ${input.pattern}`;
    if (call.toolName === "Grep" && input.pattern) return `Grep "${input.pattern}"`;
    return call.toolName;
  }

  let statusLabel = $derived(
    !call.completed ? "running" :
    call.isError ? "error" : "done"
  );

  let statusClass = $derived(
    !call.completed ? "running" :
    call.isError ? "error" : "success"
  );

  let hasOutput = $derived(!!call.stdout || !!call.stderr);
  let isEdit = $derived(call.toolName === "Edit" || call.toolName === "Write");
  let isBash = $derived(call.toolName === "Bash");
</script>

<div class="tool-block" class:expanded class:success-accent={isBash && call.completed && !call.isError} class:error-accent={call.completed && call.isError}>
  <button class="tool-header" onclick={() => expanded = !expanded}>
    <span class="material-symbols-outlined tool-icon {iconInfo.cls}">{iconInfo.icon}</span>
    <span class="tool-label">{toolLabel()}</span>
    <span class="tool-status {statusClass}">{statusLabel}</span>
    {#if hasOutput}
      <span class="material-symbols-outlined tool-chevron">expand_more</span>
    {/if}
  </button>
  {#if expanded && hasOutput}
    <div class="tool-body">
      {#if isEdit && call.stdout}
        <div class="diff-view">
          {#each call.stdout.split("\n") as line}
            <div class="diff-line" class:added={line.startsWith("+")} class:removed={line.startsWith("-")} class:context={!line.startsWith("+") && !line.startsWith("-")}>
              <span class="diff-line-content">{line}</span>
            </div>
          {/each}
        </div>
      {:else}
        <pre class="terminal-output" class:error-output={call.isError}>{call.stdout}{#if call.stderr}{"\n"}{call.stderr}{/if}</pre>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-block {
    margin-left: 30px;
    background: var(--surface-container);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .tool-block.success-accent { border-left: 2px solid var(--secondary); }
  .tool-block.error-accent { border-left: 2px solid var(--error); }

  .tool-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; cursor: pointer;
    background: none; border: none; width: 100%;
    text-align: left; color: inherit;
    transition: background 0.15s;
  }
  .tool-header:hover { background: var(--surface-container-high); }

  .tool-icon { font-size: 16px; color: var(--on-surface-variant); }
  .tool-icon.read { color: var(--cyan); }
  .tool-icon.edit { color: var(--yellow); }
  .tool-icon.terminal { color: var(--secondary); }
  .tool-icon.search { color: var(--primary); }

  .tool-label {
    font-family: var(--font-mono); font-size: 12px;
    color: var(--on-surface-variant); flex: 1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .tool-status {
    font-size: 11px; font-family: var(--font-mono);
    padding: 2px 6px; border-radius: 3px; font-weight: 500;
  }
  .tool-status.success { color: var(--secondary); background: color-mix(in srgb, var(--secondary) 10%, transparent); }
  .tool-status.error { color: var(--error); background: color-mix(in srgb, var(--error) 10%, transparent); }
  .tool-status.running { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 10%, transparent); }

  .tool-chevron {
    font-size: 16px; color: var(--on-surface-variant); opacity: 0.5;
    transition: transform 0.2s;
  }
  .tool-block.expanded .tool-chevron { transform: rotate(180deg); }

  .tool-body {
    border-top: 1px solid var(--outline-variant);
  }

  .diff-view {
    font-family: var(--font-mono); font-size: 12px;
    line-height: 1.6; overflow-x: auto;
  }
  .diff-line { padding: 0 12px; white-space: pre; }
  .diff-line.added { background: color-mix(in srgb, #97f999 8%, transparent); color: #b8ffba; }
  .diff-line.removed { background: color-mix(in srgb, #ff716c 8%, transparent); color: #ffb0ac; }
  .diff-line.context { color: var(--on-surface-variant); opacity: 0.6; }

  .terminal-output {
    padding: 10px 12px; margin: 0;
    font-family: var(--font-mono); font-size: 12px;
    line-height: 1.5; color: var(--on-surface-variant);
    white-space: pre-wrap; word-break: break-word;
    max-height: 300px; overflow-y: auto;
  }
  .terminal-output.error-output { color: var(--error); }
</style>
