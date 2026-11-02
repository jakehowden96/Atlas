<script lang="ts">
  import { untrack } from "svelte";
  import Icon, { type IconName } from "./ui/Icon.svelte";
  import {
    dismissToast,
    pauseToast,
    resumeToast,
    runToastAction,
    toasts,
    visibleToasts,
    type Toast,
  } from "../stores/toast";

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

  const META: Record<Toast["type"], { icon: IconName; word: string; colour: string }> = {
    error: { icon: "error", word: "Error", colour: "var(--danger)" },
    warning: { icon: "warning", word: "Warning", colour: "var(--warn)" },
    info: { icon: "info", word: "Info", colour: "var(--accent)" },
    success: { icon: "check_circle", word: "Success", colour: "var(--accent)" },
  };

  // Only the newest few render; `rendered` lags removals for the exit animation.
  let shownIds = $derived(new Set($visibleToasts.shown.map((t) => t.id)));
</script>

<!-- The live region stays mounted while empty: a region that appears together
     with its first message is often not announced. -->
<div class="toast-stack" role="status" aria-live="polite">
  {#each rendered.filter((t) => shownIds.has(t.id) || leaving.has(t.id)) as toast (toast.id)}
    {@const meta = META[toast.type]}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="toast"
      class:leaving={leaving.has(toast.id)}
      style="--tone: {meta.colour}"
      role={toast.type === "error" ? "alert" : undefined}
      onmouseenter={() => pauseToast(toast.id)}
      onmouseleave={() => resumeToast(toast.id)}
      onfocusin={() => pauseToast(toast.id)}
      onfocusout={() => resumeToast(toast.id)}
    >
      <span class="mark"><Icon name={meta.icon} size={18} /></span>
      <div class="text">
        <div class="title"><span class="word">{meta.word}:</span> {toast.title}</div>
        {#if toast.body}
          <div class="body">{toast.body}</div>
        {/if}
      </div>
      {#if toast.action}
        <button type="button" class="action" onclick={() => runToastAction(toast.id)}
          >{toast.action.label}</button
        >
      {/if}
      <button
        type="button"
        class="close"
        aria-label="Dismiss notification"
        onclick={() => dismissToast(toast.id)}><Icon name="close" /></button
      >
    </div>
  {/each}
  {#if $visibleToasts.hidden > 0}
    <div class="more">+{$visibleToasts.hidden} in Notifications</div>
  {/if}
</div>

<style>
  .toast-stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 340px;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border2);
    border-radius: var(--r-card-lg);
    background: var(--surface);
    box-shadow: var(--elev-2);
    animation: atlasSlideUp 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .toast.leaving {
    animation: atlasSinkOut 0.2s ease both;
  }

  .mark {
    display: flex;
    flex-shrink: 0;
    color: var(--tone);
  }

  .word {
    color: var(--tone);
  }

  .more {
    align-self: flex-end;
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .title {
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text);
  }

  .body {
    margin-top: 2px;
    font-family: var(--font-ui);
    font-size: var(--fs-xs);
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
    font-size: var(--fs-xs);
    line-height: 1.2;
    cursor: pointer;
  }

  .action:hover {
    border-color: var(--accent);
  }

  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .close:hover {
    color: var(--text);
  }
</style>
