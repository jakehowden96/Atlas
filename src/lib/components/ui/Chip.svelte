<script lang="ts">
  interface Props {
    label: string;
    count?: number;
    /** Workspace tag colour; renders the leading square dot when set. */
    colour?: string;
    selected?: boolean;
    onClick: () => void;
  }

  let { label, count, colour, selected = false, onClick }: Props = $props();
</script>

<button type="button" class="chip" class:selected onclick={onClick}>
  {#if colour}<span class="dot" style="background: {colour}"></span>{/if}
  {label}
  {#if count !== undefined}<span class="count">{count}</span>{/if}
</button>

<style>
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
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
    border-radius: 2px;
  }

  .count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    opacity: 0.7;
  }
</style>
