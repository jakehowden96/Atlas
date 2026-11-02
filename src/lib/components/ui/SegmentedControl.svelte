<script module lang="ts">
  export interface Segment<Id extends string = string> {
    id: Id;
    label: string;
    /** Rendered as a mono numeral after the label. */
    count?: number;
    /** Renders the count inside a --warn ring instead (PRs needing attention). */
    alert?: boolean;
    /** A bare --warn dot after the label. Files carries one while some open
     *  file is unsaved, which is a state rather than a count. */
    dot?: boolean;
    /** Shown but not selectable. Preview on a file that is not markdown. */
    disabled?: boolean;
  }
</script>

<script lang="ts" generics="Id extends string">
  /*
   * role "tablist" (default): the control swaps a panel. Top-bar views, Files
   * (Edit/Preview), Stats, Changes, PRs.
   * role "radiogroup": the control sets a value. Range, Unified/Split,
   * appearance, ordering, Fresh/Resume.
   * Callers are not switched yet; each picks its role in its own phase.
   */
  interface Props {
    options: Segment<Id>[];
    value: Id;
    onChange: (id: Id) => void;
    /** "md" = --h-md. "sm" = --h-sm. */
    size?: "md" | "sm";
    /** Stretch every segment to equal width (Fresh/Resume, Unified/Split). */
    fill?: boolean;
    role?: "tablist" | "radiogroup";
    /** Accessible name of the group. */
    label?: string;
  }

  let {
    options,
    value,
    onChange,
    size = "md",
    fill = false,
    role = "tablist",
    label,
  }: Props = $props();

  const itemRole = $derived(role === "tablist" ? "tab" : "radio");
  // Roving tabindex: the selected segment, else the first enabled one.
  const tabStop = $derived(
    options.find((o) => o.id === value && !o.disabled)?.id ?? options.find((o) => !o.disabled)?.id,
  );

  function onKeydown(e: KeyboardEvent) {
    const enabled = options.filter((o) => !o.disabled);
    const focused = (e.target as HTMLElement).closest<HTMLElement>("[data-seg]")?.dataset.seg;
    const at = enabled.findIndex((o) => o.id === focused);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (at - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.id);
    (e.currentTarget as HTMLElement)
      .querySelector<HTMLElement>(`[data-seg="${CSS.escape(target.id)}"]`)
      ?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="seg-group"
  class:sm={size === "sm"}
  class:fill
  {role}
  aria-label={label}
  onkeydown={onKeydown}
>
  {#each options as option (option.id)}
    <button
      type="button"
      class="seg"
      class:active={option.id === value}
      role={itemRole}
      aria-selected={role === "tablist" ? option.id === value : undefined}
      aria-checked={role === "radiogroup" ? option.id === value : undefined}
      tabindex={option.id === tabStop ? 0 : -1}
      data-seg={option.id}
      disabled={option.disabled}
      onclick={() => onChange(option.id)}
    >
      {option.label}
      {#if option.dot}<span class="dot" aria-hidden="true"></span><span class="sr"
          >needs attention</span
        >{/if}
      {#if option.count !== undefined}
        {#if option.alert}
          <span class="badge">{option.count}<span class="sr"> need attention</span></span>
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
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    min-height: var(--h-md);
    padding: 0 var(--sp-4);
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg-group.sm .seg {
    min-height: var(--h-sm);
    padding: 0 var(--sp-3);
    border-radius: var(--r-sm);
  }

  .seg-group.fill .seg {
    flex: 1;
  }

  .seg:hover:not(:disabled) {
    color: var(--text);
  }

  .seg:disabled {
    color: var(--disabled-ink);
    cursor: default;
  }

  /* --surface is only 1.1:1 against the group's --surface2 in either theme, so
     the fill alone does not say which segment is on. The hairline does. */
  .seg.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border2);
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  .dot {
    width: var(--sp-2);
    height: var(--sp-2);
    border-radius: var(--r-pill);
    background: var(--warn);
  }

  /* Transparent fill with a --warn ring: never white on --warn. */
  .badge {
    display: grid;
    place-items: center;
    min-width: var(--h-2xs);
    height: var(--h-2xs);
    padding: 0 var(--sp-1);
    border-radius: var(--r-pill);
    box-shadow: inset 0 0 0 1px var(--warn);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
