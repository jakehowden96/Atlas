<script lang="ts">
  import { untrack } from "svelte";
  import { dismissToast, runToastAction, toasts, type Toast } from "../stores/toast";

  const EXIT_MS = 200;

  /**
   * Mirrors the store, lagging removals by one exit animation — the same
   * delayed-unmount pattern `Modal.svelte` uses. Both the 4s auto-dismiss and
   * the close button remove from the store, so both animate out.
   */
  let rendered = $state<Toast[]>([]);
  let leaving = $state<Set<string>>(new Set());

  $effect(() => {
    const live = $toasts;
    untrack(() => {
      const liveIds = new Set(live.map((t) => t.id));
      const shown = new Set(rendered.map((t) => t.id));
      const added = live.filter((t) => !shown.has(t.id));
      if (added.length > 0) rendered = [...rendered, ...added];

      for (const toast of rendered) {
        if (liveIds.has(toast.id) || leaving.has(toast.id)) continue;
        const id = toast.id;
        leaving = new Set(leaving).add(id);
        setTimeout(() => {
          rendered = rendered.filter((t) => t.id !== id);
          const next = new Set(leaving);
          next.delete(id);
          leaving = next;
        }, EXIT_MS);
      }
    });
  });

  function dotColour(type: Toast["type"]): string {
    switch (type) {
      case "error":
        return "var(--danger)";
      case "warning":
        return "var(--warn)";
      default:
        return "var(--accent)";
    }
  }
</script>

{#if rendered.length > 0}
  <div class="toast-stack">
    {#each rendered as toast (toast.id)}
      <div class="toast" class:leaving={leaving.has(toast.id)}>
        <span class="dot" style="background: {dotColour(toast.type)}"></span>
        <div class="text">
          <div class="title">{toast.title}</div>
          {#if toast.body}
            <div class="body">{toast.body}</div>
          {/if}
        </div>
        {#if toast.action}
          <button
            type="button"
            class="action"
            onclick={() => runToastAction(toast.id)}>{toast.action.label}</button>
        {/if}
        <button type="button" class="close" onclick={() => dismissToast(toast.id)}>✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 320px;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border2);
    border-radius: 9px;
    background: var(--surface);
    box-shadow: var(--shadow);
    animation: atlasSlideUp 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .toast.leaving {
    animation: atlasSinkOut 0.2s ease both;
  }

  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-top: 5px;
    border-radius: 50%;
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .title {
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
  }

  .body {
    margin-top: 2px;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .action {
    flex-shrink: 0;
    padding: 3px 8px;
    border: 1px solid var(--border2);
    border-radius: var(--r-sm);
    background: var(--surface2);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 11.5px;
    line-height: 1.2;
    cursor: pointer;
  }

  .action:hover {
    border-color: var(--accent);
  }

  .close {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  .close:hover {
    color: var(--text);
  }
</style>
