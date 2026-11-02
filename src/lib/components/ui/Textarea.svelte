<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLTextareaAttributes, "value"> {
    value?: string;
    mono?: boolean;
    invalid?: boolean;
    /** Fires on blur. */
    oncommit?: (value: string) => void;
  }

  let {
    value = $bindable(""),
    mono = false,
    invalid = false,
    maxlength,
    oncommit,
    onblur,
    ...rest
  }: Props = $props();
</script>

<div class="wrap">
  <textarea
    {...rest}
    {maxlength}
    class="textarea"
    class:mono
    class:invalid
    aria-invalid={invalid ? true : undefined}
    bind:value
    onblur={(e) => {
      onblur?.(e);
      oncommit?.(value);
    }}
  ></textarea>
  {#if maxlength}
    <span class="count" aria-hidden="true">{value.length}/{maxlength}</span>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 72px;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    resize: vertical;
  }
  .textarea.mono {
    font-family: var(--font-mono);
  }
  .textarea::placeholder {
    color: var(--muted);
  }
  .textarea:hover:not(:disabled) {
    border-color: var(--muted);
  }
  .textarea:focus {
    border-color: var(--text);
  }
  .textarea.invalid {
    border-color: var(--danger);
  }
  .textarea:disabled {
    background: var(--surface2);
    color: var(--muted);
    cursor: not-allowed;
  }
  .count {
    align-self: flex-end;
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
</style>
