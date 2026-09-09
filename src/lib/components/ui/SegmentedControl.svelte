<script module lang="ts">
  export interface Segment {
    id: string;
    label: string;
    /** Rendered as a mono numeral after the label. */
    count?: number;
    /** Renders the count as a --warn pill instead (PRs needing attention). */
    alert?: boolean;
    /** A bare --warn dot after the label — Files carries one while some open
     *  file is unsaved, which is a state rather than a count. */
    dot?: boolean;
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
      {#if option.dot}<span class="dot"></span>{/if}
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
  /* Two ink tiers of the group's own. Inactive segments used to sit at
     --muted, which is 5.2:1 on --surface2 in light and 5.7:1 in dark — over
     4.5 on paper, but read at 11.5px — and the count sat at 0.7 opacity on top
     of that, which lands at 3.5:1 in light and fails outright. These clear 5:1
     at their smallest size in both themes. They live here rather than in
     app.css because app.css belongs to another change this wave. */
  .seg-group {
    --seg-ink: #4a4f57;
    --seg-count: #5c626b;
    display: flex;
    gap: 1px;
    padding: 2px;
    border-radius: var(--r-lg);
    background: var(--surface2);
  }

  :global(:root[data-theme="dark"]) .seg-group {
    --seg-ink: #adb2bb;
    --seg-count: #979da6;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .seg-group {
      --seg-ink: #adb2bb;
      --seg-count: #979da6;
    }
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
    color: var(--seg-ink);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg-group.sm .seg {
    padding: 3px 10px;
    border-radius: var(--r-sm);
    font-size: 12px;
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

  /* --surface is only 1.1:1 against the group's --surface2 in either theme, so
     the fill alone does not say which segment is on. The hairline does. */
  .seg.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--border2);
  }

  .count {
    color: var(--seg-count);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warn);
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
