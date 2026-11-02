<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLInputAttributes, "value"> {
    value?: string;
    mono?: boolean;
    invalid?: boolean;
    /** Fires on blur or Enter. */
    oncommit?: (value: string) => void;
  }

  let {
    value = $bindable(""),
    type = "text",
    mono = false,
    invalid = false,
    oncommit,
    onblur,
    onkeydown,
    ...rest
  }: Props = $props();
</script>

<input
  {...rest}
  {type}
  class="input"
  class:mono
  class:invalid
  aria-invalid={invalid ? true : undefined}
  bind:value
  onblur={(e) => {
    onblur?.(e);
    oncommit?.(value);
  }}
  onkeydown={(e) => {
    onkeydown?.(e);
    if (e.key === "Enter") oncommit?.(value);
  }}
/>

<style>
  .input {
    box-sizing: border-box;
    width: 100%;
    height: var(--h-md);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
  }
  .input.mono {
    font-family: var(--font-mono);
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
  .input.invalid {
    border-color: var(--danger);
  }
  .input:disabled {
    background: var(--surface2);
    color: var(--muted);
    cursor: not-allowed;
  }
</style>
