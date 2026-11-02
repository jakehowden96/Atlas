<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";

  interface Props extends Omit<HTMLInputAttributes, "value" | "type"> {
    value?: string;
  }

  let { value = $bindable(""), onkeydown, ...rest }: Props = $props();
  let el: HTMLInputElement | undefined = $state();
</script>

<div class="search">
  <span class="lead"><Icon name="search" /></span>
  <input
    {...rest}
    bind:this={el}
    bind:value
    type="search"
    class="input"
    onkeydown={(e) => {
      onkeydown?.(e);
      if (e.key !== "Escape") return;
      if (value) {
        value = "";
        e.preventDefault();
        e.stopPropagation();
      } else el?.blur();
    }}
  />
  {#if value}
    <button
      type="button"
      class="clear"
      aria-label="Clear search"
      onclick={() => {
        value = "";
        el?.focus();
      }}><Icon name="close" /></button
    >
  {/if}
</div>

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
  }
  .lead {
    position: absolute;
    left: var(--sp-3);
    display: flex;
    color: var(--muted);
    pointer-events: none;
  }
  .input {
    box-sizing: border-box;
    width: 100%;
    height: var(--h-md);
    padding: 0 var(--h-md) 0 calc(var(--sp-3) + 16px + var(--sp-2));
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    appearance: none;
  }
  .input::-webkit-search-cancel-button {
    display: none;
  }
  .input::placeholder {
    color: var(--muted);
  }
  .input:hover:not(:disabled) {
    border-color: var(--muted);
  }
  .input:focus {
    border-color: var(--text);
  }
  .input:disabled {
    background: var(--surface2);
    color: var(--muted);
    cursor: not-allowed;
  }
  .clear {
    position: absolute;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--h-md);
    height: var(--h-md);
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .clear:hover {
    color: var(--text);
  }
</style>
