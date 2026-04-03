<script lang="ts">
  import { toasts, dismissToast, type Toast } from "../stores/toast";

  let items = $derived<Toast[]>($toasts);

  function typeColor(type: Toast["type"]): string {
    switch (type) {
      case "error":
        return "var(--error)";
      case "warning":
        return "var(--yellow)";
      default:
        return "var(--primary)";
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
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 400px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: var(--spacing-5) var(--spacing-5);
    background: var(--surface-container-highest);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 20%, transparent);
    border-left: 3px solid;
    border-radius: var(--radius-md);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    animation: slide-in 0.2s ease-out;
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .toast-message {
    flex: 1;
    font-size: 13px;
    color: var(--on-surface);
    line-height: 1.45;
    font-family: var(--font-body);
  }

  .toast-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    color: var(--on-surface-variant);
    font-size: 15px;
    cursor: pointer;
    border-radius: 6px;
    padding: 0;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }

  .toast-dismiss:hover {
    background: var(--surface-bright);
    color: var(--on-surface);
  }
</style>
