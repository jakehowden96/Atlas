<script module lang="ts">
  import type { IconName } from "./Icon.svelte";

  export interface MenuItem {
    id: string;
    label: string;
    icon?: IconName;
    shortcut?: string;
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
    /** Defaults to a plain item. */
    kind?: "item" | "checkbox" | "radio";
    checked?: boolean;
    /** One level of submenu. */
    children?: MenuItem[];
  }
</script>

<script lang="ts">
  import Popover from "./Popover.svelte";
  import Icon from "./Icon.svelte";
  import Kbd from "./Kbd.svelte";
  import type { Align, Side } from "../../ui/floating";

  interface Props {
    open?: boolean;
    trigger: HTMLElement | undefined;
    items: MenuItem[];
    onselect?: (item: MenuItem) => void;
    /** Called once after the menu closes, however it closed. */
    onclose?: () => void;
    label?: string;
    side?: Side;
    align?: Align;
  }

  let {
    open = $bindable(false),
    trigger,
    items,
    onselect,
    onclose,
    label,
    side = "bottom",
    align = "start",
  }: Props = $props();

  let menuEl = $state<HTMLElement>();
  let subOf = $state<string | null>(null);
  let wasOpen = false;
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  const anyLead = $derived(items.some((i) => i.icon || (i.kind && i.kind !== "item")));

  $effect(() => {
    if (open) {
      wasOpen = true;
    } else {
      subOf = null;
      if (wasOpen) {
        wasOpen = false;
        onclose?.();
      }
    }
  });

  $effect(() => {
    if (menuEl) enabled(menuEl)[0]?.focus();
  });

  /** Enabled rows that belong directly to this menu level. */
  function enabled(menu: HTMLElement): HTMLElement[] {
    return [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (el) => el.closest('[role="menu"]') === menu && el.getAttribute("aria-disabled") !== "true",
    );
  }

  function activate(item: MenuItem, row: HTMLElement) {
    if (item.disabled) return;
    if (item.children?.length) {
      subOf = item.id;
      queueMicrotask(() => {
        const sub = row.parentElement?.querySelector<HTMLElement>('[role="menu"]');
        if (sub) enabled(sub)[0]?.focus();
      });
      return;
    }
    open = false;
    onselect?.(item);
  }

  function itemOf(row: HTMLElement): MenuItem | undefined {
    const id = row.dataset.id;
    for (const i of items) {
      if (i.id === id) return i;
      const c = i.children?.find((x) => x.id === id);
      if (c) return c;
    }
    return undefined;
  }

  // Native listener (not delegated) so stopPropagation beats Popover's document-level Esc handler.
  function keys(node: HTMLElement) {
    node.addEventListener("keydown", onkeydown);
    return { destroy: () => node.removeEventListener("keydown", onkeydown) };
  }

  // One handler on the root menu; submenus are nested in its DOM so their keys bubble here.
  function onkeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('[role^="menuitem"]');
    const menu = target.closest<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const list = enabled(menu);
    const at = row ? list.indexOf(row) : -1;
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return go(at + 1);
      case "ArrowUp":
        return go(at < 0 ? -1 : at - 1);
      case "Home":
        return go(0);
      case "End":
        return go(-1);
      case "ArrowRight": {
        const item = row && itemOf(row);
        if (row && item?.children?.length) {
          e.preventDefault();
          activate(item, row);
        }
        return;
      }
      case "ArrowLeft":
      case "Escape": {
        if (menu !== menuEl) {
          // Close the submenu only; the document-level Esc handler must not also close the root.
          e.preventDefault();
          e.stopPropagation();
          const parent = menu.parentElement?.querySelector<HTMLElement>('[role^="menuitem"]');
          subOf = null;
          parent?.focus();
        }
        return;
      }
      case "Enter":
      case " ": {
        const item = row && itemOf(row);
        if (row && item) {
          e.preventDefault();
          activate(item, row);
        }
        return;
      }
      case "Tab":
        open = false;
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typed += e.key.toLowerCase();
      clearTimeout(typedTimer);
      typedTimer = setTimeout(() => (typed = ""), 500);
      const from = typed.length > 1 ? at : at + 1;
      const order = [...list.slice(from), ...list.slice(0, from)];
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(typed))?.focus();
    }
  }
</script>

{#snippet rows(list: MenuItem[], nested: boolean)}
  {#each list as item (item.id)}
    {#if item.separatorBefore}<div class="sep" role="separator"></div>{/if}
    <div class="wrap">
      <div
        class="row"
        class:danger={item.danger}
        class:disabled={item.disabled}
        role={item.kind === "checkbox" ? "menuitemcheckbox" : item.kind === "radio" ? "menuitemradio" : "menuitem"}
        tabindex="-1"
        data-id={item.id}
        aria-disabled={item.disabled ? "true" : undefined}
        aria-checked={item.kind && item.kind !== "item" ? !!item.checked : undefined}
        aria-haspopup={item.children?.length ? "menu" : undefined}
        aria-expanded={item.children?.length ? subOf === item.id : undefined}
        onclick={(e) => activate(item, e.currentTarget)}
        onpointerenter={() => {
          if (nested) return;
          if (item.children?.length && !item.disabled) subOf = item.id;
          else subOf = null;
        }}
      >
        <span class="lead">
          {#if item.kind && item.kind !== "item"}
            {#if item.checked}<Icon name="check" />{/if}
          {:else if item.icon}
            <Icon name={item.icon} />
          {/if}
        </span>
        <span class="label">{item.label}</span>
        {#if item.shortcut}<Kbd>{item.shortcut}</Kbd>{/if}
        {#if item.children?.length}<Icon name="chevron_right" />{/if}
      </div>
      {#if item.children?.length && subOf === item.id}
        <div class="menu sub" role="menu" aria-label={item.label} tabindex="-1">
          {@render rows(item.children, true)}
        </div>
      {/if}
    </div>
  {/each}
{/snippet}

<Popover bind:open {trigger} {side} {align} {label}>
  <div class="menu" class:no-lead={!anyLead} role="menu" aria-label={label} bind:this={menuEl} use:keys tabindex="-1">
    {@render rows(items, false)}
  </div>
</Popover>

<style>
  /* Popover pads 12px; the menu wants 4px. */
  .menu {
    min-width: 180px;
    margin: -8px;
    padding: var(--sp-1);
    outline: none;
  }
  .sub {
    position: absolute;
    top: calc(-1 * var(--sp-1) - 1px);
    left: 100%;
    margin: 0;
    border: 1px solid var(--border2);
    border-radius: var(--r-card);
    background: var(--surface);
    box-shadow: var(--elev-1);
  }
  .wrap {
    position: relative;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: var(--h-md);
    padding: 0 var(--sp-3);
    box-sizing: border-box;
    border-radius: var(--r-md);
    color: var(--text);
    font-size: var(--fs-sm);
    cursor: pointer;
    white-space: nowrap;
    outline: none;
  }
  .row:hover,
  .row:focus-visible {
    background: var(--hover-bg);
  }
  .row.danger {
    color: var(--danger);
  }
  .row.disabled {
    color: var(--disabled-ink);
    cursor: default;
  }
  .row.disabled:hover {
    background: transparent;
  }
  .lead {
    display: inline-flex;
    width: 16px;
    flex: none;
  }
  .no-lead > .wrap > .row > .lead {
    display: none;
  }
  .label {
    flex: 1;
  }
  .sep {
    height: 1px;
    margin: var(--sp-1) 0;
    background: var(--border);
  }
</style>
