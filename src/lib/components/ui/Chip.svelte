<script lang="ts">
  interface Props {
    label: string;
    count?: number;
    /** Workspace tag colour; renders as a leading swatch, never as text. */
    colour?: string;
    selected?: boolean;
    onClick: () => void;
  }

  let { label, count, colour, selected = false, onClick }: Props = $props();
</script>

<button type="button" class="chip" class:selected aria-pressed={selected} onclick={onClick}>
  {#if colour}<span class="dot" style="background: {colour}"></span>{/if}
  {label}
  {#if count !== undefined}<span class="count">{count}</span>{/if}
</button>

<style>
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--h-md);
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .chip:hover {
    border-color: var(--border2);
  }

  .chip.selected {
    border-color: var(--text);
    background: var(--ink);
    color: var(--ink-text);
  }

  .dot {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: var(--r-xs);
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
  }
</style>
