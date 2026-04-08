<script lang="ts">
  interface Props {
    label: string;
    loadingLabel?: string;
    icon?: string;
    variant?: "primary" | "secondary" | "surface" | "danger";
    disabled?: boolean;
    loading?: boolean;
    done?: boolean;
    onclick?: () => void;
  }

  let {
    label,
    loadingLabel,
    icon,
    variant = "surface",
    disabled = false,
    loading = false,
    done = false,
    onclick,
  }: Props = $props();
</script>

<button
  class="action-btn variant-{variant}"
  class:is-loading={loading}
  class:is-done={done}
  disabled={disabled || loading || done}
  {onclick}
>
  {#if loading}
    <span class="material-symbols-outlined spinner">progress_activity</span>
    {loadingLabel ?? label}
  {:else if done}
    <span class="material-symbols-outlined done-icon">check_circle</span>
    {label}
  {:else}
    {#if icon}
      <span class="material-symbols-outlined btn-icon">{icon}</span>
    {/if}
    {label}
  {/if}
</button>

<style>
  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.6rem 1.5rem;
    min-width: 0;
    border: none;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: background 0.3s ease, opacity 0.3s ease, color 0.3s ease, border-color 0.3s ease;
    white-space: nowrap;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  /* Loading state */
  .action-btn.is-loading {
    opacity: 0.85;
  }

  /* Done: green bg */
  .action-btn.is-done {
    background: var(--secondary) !important;
    color: var(--on-primary) !important;
    border-color: transparent !important;
    opacity: 1 !important;
    transition: background 0.3s ease, color 0.3s ease;
  }

  /* --- Variants --- */

  .variant-primary {
    background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 20%, var(--surface-container-highest)), color-mix(in srgb, var(--primary) 30%, var(--surface-container-highest)));
    color: var(--primary);
  }

  .variant-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--primary) 25%, var(--surface-container-highest));
  }

  .variant-secondary {
    background: linear-gradient(135deg, var(--secondary-container), color-mix(in srgb, var(--secondary-container) 80%, var(--secondary)));
    color: var(--secondary);
  }

  .variant-secondary:hover:not(:disabled) {
    background: var(--secondary-container);
  }

  .variant-surface {
    background: var(--surface-container-high);
    border: 1px solid color-mix(in srgb, var(--outline-variant) 30%, transparent);
    color: var(--on-surface);
  }

  .variant-surface:hover:not(:disabled) {
    background: var(--surface-container-highest);
    border-color: color-mix(in srgb, var(--outline-variant) 50%, transparent);
  }

  .variant-danger {
    background: var(--surface-container-highest);
    color: var(--on-surface-variant);
  }

  .variant-danger:hover:not(:disabled) {
    background: var(--surface-bright);
    color: var(--on-surface);
  }

  /* --- Icons --- */

  .spinner {
    font-size: 0.9rem;
    animation: spin 1s linear infinite;
  }

  .done-icon {
    font-size: 1.1rem;
    font-variation-settings: 'FILL' 1;
  }

  .btn-icon {
    font-size: 0.9rem;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
