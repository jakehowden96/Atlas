<script module lang="ts">
  export interface Segment {
    id: string;
    label: string;
    /** Rendered as a mono numeral after the label. */
    count?: number;
    /** Renders the count as a --warn pill instead (PRs needing attention). */
    alert?: boolean;
    /** Shown but not selectable — Preview on a file that is not markdown. */
    disabled?: boolean;
  }
</script>

<script lang="ts">
  interface Props {
    options: Segment[];
    value: string;
    onChange: (id: string) => void;
    /** "md" = 12px / 4px 12px. "sm" = 11.5px / 3px 10px. */
    size?: "md" | "sm";
    /** Stretch every segment to equal width (Fresh/Resume, Unified/Split). */
    fill?: boolean;
  }

  let { options, value, onChange, size = "md", fill = false }: Props = $props();
</script>

<div class="seg-group" class:sm={size === "sm"} class:fill>
  {#each options as option (option.id)}
    <button
      type="button"
      class="seg"
      class:active={option.id === value}
      disabled={option.disabled}
      onclick={() => onChange(option.id)}
    >
      {option.label}
      {#if option.count !== undefined}
        {#if option.alert}
          <span class="badge">{option.count}</span>
        {:else}
          <span class="count">{option.count}</span>
        {/if}
      {/if}
    </button>
  {/each}
</div>

<style>
  .seg-group {
    display: flex;
    gap: 1px;
    padding: 2px;
    border-radius: var(--r-lg);
    background: var(--surface2);
  }

  .seg-group.sm {
    border-radius: var(--r-md);
  }

  .seg {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px 12px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg-group.sm .seg {
    padding: 3px 10px;
    border-radius: var(--r-sm);
    font-size: 11.5px;
  }

  .seg-group.fill .seg {
    flex: 1;
  }

  .seg:hover:not(:disabled) {
    color: var(--text);
  }

  .seg:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .seg.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    opacity: 0.7;
  }

  .badge {
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--warn);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
  }
</style>
