<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
    tabindex: number;
    value: string;
    onSelect: () => void;
  }

  let {
    checked,
    label,
    description,
    disabled = false,
    tabindex,
    value,
    onSelect,
  }: Props = $props();
</script>

<button
  type="button"
  class="radio"
  role="radio"
  aria-checked={checked}
  data-value={value}
  {tabindex}
  {disabled}
  onclick={onSelect}
>
  <span class="dot" class:on={checked}></span>
  <span class="text">
    <span class="label">{label}</span>
    {#if description}<span class="desc">{description}</span>{/if}
  </span>
</button>

<style>
  .radio {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .radio:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .dot {
    position: relative;
    flex: none;
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border: 1px solid var(--border2);
    border-radius: 50%;
    background: var(--surface);
  }
  .dot.on {
    border-color: var(--ink);
  }
  .dot.on::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 7px;
    height: 7px;
    margin: -3.5px 0 0 -3.5px;
    border-radius: 50%;
    background: var(--ink);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .desc {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
