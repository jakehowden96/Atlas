<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";

  interface Props extends Omit<HTMLButtonAttributes, "children"> {
    variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
    size?: "sm" | "md" | "lg";
    loading?: boolean;
    leading?: Snippet;
    trailing?: Snippet;
    children: Snippet;
  }

  let {
    variant = "secondary",
    size = "md",
    loading = false,
    disabled = false,
    type = "button",
    onclick,
    leading,
    trailing,
    children,
    ...rest
  }: Props = $props();
</script>

<button
  {...rest}
  {type}
  class="btn {variant} {size}"
  class:loading
  {disabled}
  aria-busy={loading ? "true" : undefined}
  onclick={(e) => {
    if (loading) return;
    onclick?.(e);
  }}
>
  {#if loading}
    <span class="spin" class:overlay={!leading}><Icon name="progress_activity" /></span>
  {/if}
  <span class="content" class:hidden={loading && !leading}>
    {#if leading && !loading}{@render leading()}{/if}
    {@render children()}
    {#if trailing}{@render trailing()}{/if}
  </span>
</button>

<style>
  .btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    border: 1px solid transparent;
    font-family: inherit;
    font-weight: var(--fw-medium);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .content {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .content.hidden {
    visibility: hidden;
  }
  .sm {
    height: var(--h-sm);
    padding: 0 var(--sp-3);
    font-size: var(--fs-xs);
    border-radius: var(--r-md);
  }
  .md {
    height: var(--h-md);
    padding: 0 var(--sp-4);
    font-size: var(--fs-sm);
    border-radius: var(--r-lg);
  }
  .lg {
    height: var(--h-lg);
    padding: 0 14px;
    font-size: var(--fs-sm);
    border-radius: var(--r-lg);
  }

  .primary {
    background: var(--ink);
    color: var(--ink-text);
  }
  .primary:hover {
    background: var(--ink-hover-bg);
  }
  .secondary {
    background: var(--surface);
    border-color: var(--border2);
    color: var(--text);
  }
  .secondary:hover {
    background: var(--hover-bg);
  }
  .ghost {
    background: transparent;
    color: var(--muted);
  }
  .ghost:hover {
    background: var(--hover-bg);
    color: var(--text);
  }
  .danger {
    background: var(--surface);
    border-color: var(--border2);
    color: var(--danger);
  }
  .danger:hover {
    border-color: var(--danger);
  }
  .link {
    height: auto;
    padding: 0;
    border-radius: 0;
    background: transparent;
    border-width: 0 0 1px;
    border-color: var(--border2);
    color: var(--text);
  }
  .link:hover {
    border-color: var(--text);
  }
  .secondary:active,
  .ghost:active {
    background: var(--active-bg);
  }

  .btn:disabled {
    background: var(--disabled-bg);
    border-color: var(--disabled-border);
    color: var(--disabled-ink);
    cursor: default;
  }
  .link:disabled {
    background: transparent;
  }
  /* Loading keeps the variant's own colours; only the click is ignored. */
  .loading {
    cursor: default;
  }

  .spin {
    display: inline-flex;
    animation: atlasSpin 1s linear infinite;
  }
  .spin.overlay {
    position: absolute;
  }
</style>
