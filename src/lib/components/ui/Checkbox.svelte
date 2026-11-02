<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    label?: string;
    children?: Snippet;
  }

  let {
    checked = $bindable(false),
    indeterminate = $bindable(false),
    disabled = false,
    label,
    children,
  }: Props = $props();

  let input = $state<HTMLInputElement>();

  // `indeterminate` is a DOM property with no attribute.
  $effect(() => {
    if (input) input.indeterminate = indeterminate;
  });
</script>

<label class="cb" class:disabled>
  <span class="box">
    <input
      bind:this={input}
      type="checkbox"
      bind:checked
      {disabled}
      aria-label={children ? undefined : label}
      onchange={() => (indeterminate = false)}
    />
    {#if indeterminate}
      <Icon name="remove" />
    {:else if checked}
      <Icon name="check" />
    {/if}
  </span>
  {#if children}<span class="text">{@render children()}</span>{/if}
</label>

<style>
  .cb {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: var(--fs-sm);
    color: var(--text);
  }
  .cb.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .box {
    position: relative;
    display: inline-flex;
    width: 16px;
    height: 16px;
    flex: none;
    color: var(--bg);
  }
  input {
    appearance: none;
    margin: 0;
    width: 16px;
    height: 16px;
    border: 1px solid var(--border2);
    border-radius: var(--r-xs);
    background: var(--surface);
    cursor: inherit;
  }
  input:checked,
  input:indeterminate {
    background: var(--ink);
    border-color: var(--ink);
  }
  .box :global(.material-symbols-outlined) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
</style>
