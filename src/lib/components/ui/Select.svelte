<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import Popover from "./Popover.svelte";

  export interface SelectOption {
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
    group?: string;
  }

  interface Props {
    options: SelectOption[];
    value?: string | undefined;
    onChange?: (id: string) => void;
    placeholder?: string;
    invalid?: boolean;
    disabled?: boolean;
    size?: "sm" | "md";
    /** From Field's snippet: id, aria-describedby, aria-required. */
    id?: string;
    "aria-describedby"?: string;
    "aria-required"?: boolean | "true" | "false";
    "aria-label"?: string;
  }

  let {
    options,
    value = $bindable(undefined),
    onChange,
    placeholder = "Select",
    invalid = false,
    disabled = false,
    size = "md",
    id,
    "aria-describedby": describedby,
    "aria-required": required,
    "aria-label": ariaLabel,
  }: Props = $props();

  const uid = $props.id();
  const listId = `${uid}-list`;
  const optId = (o: SelectOption) => `${uid}-opt-${o.id}`;

  let open = $state(false);
  let trigger = $state<HTMLElement>();
  let active = $state<string | undefined>();
  let width = $state(0);
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  const selected = $derived(options.find((o) => o.id === value));
  const activeOpt = $derived(options.find((o) => o.id === active));
  const enabled = $derived(options.filter((o) => !o.disabled));
  // Contiguous runs of the same group, in source order.
  const groups = $derived.by(() => {
    const out: { label?: string; items: SelectOption[] }[] = [];
    for (const o of options) {
      const last = out[out.length - 1];
      if (last && last.label === o.group) last.items.push(o);
      else out.push({ label: o.group, items: [o] });
    }
    return out;
  });

  function show() {
    if (disabled) return;
    width = trigger?.getBoundingClientRect().width ?? 0;
    active = selected && !selected.disabled ? selected.id : enabled[0]?.id;
    open = true;
  }

  function choose(o: SelectOption) {
    if (o.disabled) return;
    value = o.id;
    onChange?.(o.id);
    open = false;
  }

  function move(to: number) {
    if (!enabled.length) return;
    active = enabled[Math.min(Math.max(to, 0), enabled.length - 1)]?.id;
  }

  const activeIndex = () => enabled.findIndex((o) => o.id === active);

  function typeahead(ch: string) {
    clearTimeout(typedTimer);
    typed += ch.toLowerCase();
    typedTimer = setTimeout(() => (typed = ""), 600);
    const from = activeIndex();
    // A repeated single letter cycles; a longer prefix searches from the current row.
    const start = typed.length === 1 ? from + 1 : Math.max(from, 0);
    const order = [...enabled.slice(start), ...enabled.slice(0, start)];
    const hit = order.find((o) => o.label.toLowerCase().startsWith(typed));
    if (hit) active = hit.id;
  }

  function onkeydown(e: KeyboardEvent) {
    if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        show();
      } else if (e.key.length === 1) {
        show();
        typeahead(e.key);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(activeIndex() + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(activeIndex() - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(enabled.length - 1);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        if (activeOpt) choose(activeOpt);
        break;
      }
      case "Tab":
        open = false;
        break;
      default:
        if (e.key.length === 1) {
          e.preventDefault();
          typeahead(e.key);
        }
    }
  }

  $effect(() => {
    if (!open || !activeOpt) return;
    const target = optId(activeOpt);
    void tick().then(() => document.getElementById(target)?.scrollIntoView?.({ block: "nearest" }));
  });
</script>

<button
  bind:this={trigger}
  {id}
  type="button"
  role="combobox"
  class="select {size}"
  class:invalid
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? listId : undefined}
  aria-activedescendant={open && activeOpt ? optId(activeOpt) : undefined}
  aria-invalid={invalid ? true : undefined}
  aria-describedby={describedby}
  aria-required={required}
  aria-label={ariaLabel}
  {disabled}
  onclick={() => (open ? (open = false) : show())}
  {onkeydown}
>
  <span class="value" class:placeholder={!selected}>{selected?.label ?? placeholder}</span>
  <Icon name="expand_more" />
</button>

<Popover bind:open {trigger} align="start">
  <!-- Focus stays on the trigger; mousedown must not steal it. -->
  <div
    class="list"
    id={listId}
    role="listbox"
    tabindex="-1"
    aria-label={ariaLabel}
    style:min-width="{width}px"
    onmousedown={(e) => e.preventDefault()}
  >
    {#each groups as g, gi (gi)}
      {#if g.label}
        <div role="group" aria-labelledby="{uid}-g{gi}">
          <div class="group-label" id="{uid}-g{gi}">{g.label}</div>
          {#each g.items as o (o.id)}
            {@render row(o)}
          {/each}
        </div>
      {:else}
        {#each g.items as o (o.id)}
          {@render row(o)}
        {/each}
      {/if}
    {/each}
  </div>
</Popover>

{#snippet row(o: SelectOption)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    id={optId(o)}
    class="opt"
    class:active={o.id === active}
    role="option"
    tabindex="-1"
    aria-selected={o.id === value}
    aria-disabled={o.disabled ? true : undefined}
    onclick={() => choose(o)}
    onpointermove={() => !o.disabled && (active = o.id)}
  >
    <span class="text">
      <span class="label">{o.label}</span>
      {#if o.description}<span class="desc">{o.description}</span>{/if}
    </span>
    {#if o.id === value}<Icon name="check" />{/if}
  </div>
{/snippet}

<style>
  .select {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    width: 100%;
    height: var(--h-md);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border2);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .select.sm {
    height: var(--h-sm);
  }
  .select:hover:not(:disabled) {
    border-color: var(--muted);
  }
  .select[aria-expanded="true"] {
    border-color: var(--text);
  }
  .select.invalid {
    border-color: var(--danger);
  }
  .select:disabled {
    background: var(--surface2);
    color: var(--muted);
    cursor: not-allowed;
  }
  .value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value.placeholder {
    color: var(--muted);
  }
  .list {
    box-sizing: border-box;
    max-height: 280px;
    overflow-y: auto;
  }
  .group-label {
    padding: var(--sp-2) var(--sp-3) var(--sp-1);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-medium);
    color: var(--muted);
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    min-height: var(--h-md);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .opt.active {
    background: var(--surface2);
  }
  .opt[aria-selected="true"] .label {
    font-weight: var(--fw-medium);
  }
  .opt[aria-disabled="true"] {
    color: var(--muted);
    cursor: not-allowed;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .desc {
    font-size: var(--fs-2xs);
    color: var(--muted);
  }
</style>
