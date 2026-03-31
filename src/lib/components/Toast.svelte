<script lang="ts">
  import { toasts, dismissToast, type Toast } from "../stores/toast";

  let items: Toast[] = $state([]);

  $effect(() => {
    const unsub = toasts.subscribe((v) => (items = v));
    return unsub;
  });

  function typeColor(type: Toast["type"]): string {
    switch (type) {
      case "error":
        return "var(--red)";
      case "warning":
        return "var(--yellow)";
      default:
        return "var(--blue)";
    }
  }
</script>

{#if items.length > 0}
  <div class="toast-container">
    {#each items as toast (toast.id)}
      <div
        class="toast"
        style="border-left-color: {typeColor(toast.type)}"
      >
        <span class="toast-message">{toast.message}</span>
        <button class="toast-dismiss" onclick={() => dismissToast(toast.id)}>
          &times;
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 400px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--bg-light);
    border: 1px solid var(--border);
    border-left: 3px solid;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    animation: slide-in 0.2s ease-out;
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .toast-message {
    flex: 1;
    font-size: 13px;
    color: var(--fg);
    line-height: 1.4;
  }

  .toast-dismiss {
    background: none;
    border: none;
    color: var(--fg-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .toast-dismiss:hover {
    color: var(--fg);
  }
</style>
