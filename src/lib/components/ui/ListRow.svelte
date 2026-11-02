<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    selected?: boolean;
    disabled?: boolean;
    /** Row is an option inside a listbox. Otherwise it is a button or link per `as`. */
    option?: boolean;
    /** DOM id, for a combobox's aria-activedescendant. */
    id?: string;
    as?: "button" | "a";
    href?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
    /** Trailing actions, shown on hover or focus-within. Repeat them in the context menu. */
    actions?: Snippet;
  }

  let {
    selected = false,
    disabled = false,
    option = false,
    id,
    as = "button",
    href,
    onclick,
    children,
    actions,
  }: Props = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget || disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  }
</script>

{#if option}
  <div
    class="row focus-inset"
    class:selected
    class:disabled
    {id}
    role="option"
    aria-selected={selected}
    aria-disabled={disabled || undefined}
    tabindex={disabled ? -1 : 0}
    {onclick}
    {onkeydown}
  >
    <span class="main">{@render children()}</span>
    {#if actions}<span class="actions">{@render actions()}</span>{/if}
  </div>
{:else}
  <div class="row" class:selected class:disabled>
    {#if as === "a"}
      <a
        class="main focus-inset"
        {href}
        aria-current={selected ? "true" : undefined}
        aria-disabled={disabled || undefined}
        tabindex={disabled ? -1 : undefined}
        {onclick}>{@render children()}</a
      >
    {:else}
      <button
        type="button"
        class="main focus-inset"
        aria-pressed={selected || undefined}
        {disabled}
        {onclick}>{@render children()}</button
      >
    {/if}
    {#if actions}<span class="actions">{@render actions()}</span>{/if}
  </div>
{/if}

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--h-lg);
    padding: 0 var(--sp-2);
    border-radius: var(--r-md);
    color: var(--text);
    font-size: var(--fs-md);
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface2);
  }
  .row.selected {
    background: var(--surface3);
    font-weight: var(--fw-semi);
  }
  .row.disabled {
    color: var(--muted);
    cursor: default;
  }
  .row.disabled:hover {
    background: transparent;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: inherit;
  }
  .actions {
    display: none;
    align-items: center;
    gap: var(--sp-1);
    flex: none;
  }
  .row:hover .actions,
  .row:focus-within .actions {
    display: flex;
  }
</style>
