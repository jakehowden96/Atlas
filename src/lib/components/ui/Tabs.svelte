<script module lang="ts">
  export interface Tab {
    id: string;
    label: string;
    /** Unsaved: a dot that turns into the close button on hover or focus. */
    dirty?: boolean;
    /** Vertical only: a heading is drawn when this changes between tabs. */
    group?: string;
    /** Horizontal only: a rule is drawn before this tab. */
    divider?: boolean;
  }

  /**
   * Which tabs fit in `avail` px. The selected tab is always visible (it takes
   * its place first, then the rest fill in order); the others collapse into the
   * "+n" menu. `moreW` is reserved for that button once anything is hidden.
   */
  export function partitionTabs(
    widths: number[],
    selected: number,
    avail: number,
    moreW: number,
  ): { visible: number[]; hidden: number[] } {
    const all = widths.map((_, i) => i);
    if (widths.reduce((a, b) => a + b, 0) <= avail) return { visible: all, hidden: [] };
    let room = avail - moreW;
    const keep = new Set<number>();
    if (selected >= 0) {
      keep.add(selected);
      room -= widths[selected] ?? 0;
    }
    for (const i of all) {
      const w = widths[i] ?? 0;
      if (keep.has(i) || w > room) continue;
      keep.add(i);
      room -= w;
    }
    return { visible: all.filter((i) => keep.has(i)), hidden: all.filter((i) => !keep.has(i)) };
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";
  import MenuButton from "./MenuButton.svelte";

  interface Props {
    tabs: Tab[];
    value: string;
    onselect: (id: string) => void;
    onclose?: (id: string) => void;
    vertical?: boolean;
    /** Accessible name of the tablist. */
    label: string;
    /** Content of the selected tab, rendered in its tabpanel. */
    panel?: Snippet<[Tab]>;
  }

  let { tabs, value, onselect, onclose, vertical = false, label, panel }: Props = $props();

  const uid = $props.id();
  const MORE_W = 56; // shortcut: fixed width reserved for the "+n" button
  const GUESS_W = 120; // width assumed for a tab that has not been rendered yet

  let bar = $state<HTMLElement>();
  let avail = $state(0);
  let measured = $state<Record<string, number>>({});

  $effect(() => {
    if (!bar || vertical) return;
    const el = bar;
    const ro = new ResizeObserver(() => (avail = el.clientWidth));
    ro.observe(el);
    avail = el.clientWidth;
    return () => ro.disconnect();
  });

  // Remember each rendered tab's width so hidden ones can be placed later.
  $effect(() => {
    if (!bar || vertical) return;
    void tabs;
    void value;
    let next: Record<string, number> | undefined;
    for (const el of bar.querySelectorAll<HTMLElement>("[data-tab]")) {
      const w = el.offsetWidth;
      if (w && w !== measured[el.dataset.tab!]) (next ??= { ...measured })[el.dataset.tab!] = w;
    }
    if (next) measured = next;
  });

  const parts = $derived.by(() => {
    const all = tabs.map((_, i) => i);
    // Unmeasured (no layout yet) shows everything.
    if (vertical || avail === 0) return { visible: all, hidden: [] as number[] };
    return partitionTabs(
      tabs.map((t) => measured[t.id] ?? GUESS_W),
      tabs.findIndex((t) => t.id === value),
      avail,
      MORE_W,
    );
  });
  const visible = $derived(parts.visible.flatMap((i) => tabs[i] ?? []));
  const hidden = $derived(parts.hidden.flatMap((i) => tabs[i] ?? []));
  const tabStop = $derived(visible.find((t) => t.id === value)?.id ?? visible[0]?.id);
  const selected = $derived(tabs.find((t) => t.id === value));

  function onKeydown(e: KeyboardEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (!id) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
      e.preventDefault();
      onclose?.(id);
      return;
    }
    const prev = vertical ? "ArrowUp" : "ArrowLeft";
    const next = vertical ? "ArrowDown" : "ArrowRight";
    const at = visible.findIndex((t) => t.id === id);
    let to: number;
    if (e.key === next) to = (at + 1) % visible.length;
    else if (e.key === prev) to = (at - 1 + visible.length) % visible.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = visible.length - 1;
    else return;
    e.preventDefault();
    const dest = visible[to];
    if (!dest) return;
    onselect(dest.id);
    bar?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(dest.id)}"] [role="tab"]`)?.focus();
  }
</script>

<div class="tabs" class:vertical>
  <div class="row">
    <div
      class="list"
      role="tablist"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      tabindex="-1"
      bind:this={bar}
      onkeydown={onKeydown}
    >
      {#each visible as t, i (t.id)}
        {#if vertical && t.group && t.group !== visible[i - 1]?.group}
          <div class="heading" role="presentation">{t.group}</div>
        {/if}
        <div
          class="item"
          class:sel={t.id === value}
          class:divider={t.divider && !vertical}
          data-tab={t.id}
        >
          <button
            type="button"
            role="tab"
            id="{uid}-tab-{t.id}"
            class="tab"
            aria-selected={t.id === value}
            aria-controls="{uid}-panel-{t.id}"
            tabindex={t.id === tabStop ? 0 : -1}
            onclick={() => onselect(t.id)}
            onauxclick={(e) => {
              if (e.button === 1 && onclose) {
                e.preventDefault();
                onclose(t.id);
              }
            }}>{t.label}</button
          >
          {#if onclose}
            <span class="cl" class:dirty={t.dirty}>
              {#if t.dirty}<span class="dot" aria-hidden="true"></span>{/if}
              <IconButton
                icon="close"
                size="sm"
                label="Close {t.label}"
                tabindex={-1}
                onclick={() => onclose(t.id)}
              />
            </span>
          {/if}
        </div>
      {/each}
    </div>
    {#if hidden.length}
      <MenuButton
        label="+{hidden.length}"
        items={hidden.map((t) => ({ id: t.id, label: t.label }))}
        onselect={(m) => onselect(m.id)}
        align="end"
      />
    {/if}
  </div>
  {#if selected && panel}
    <div
      role="tabpanel"
      id="{uid}-panel-{selected.id}"
      aria-labelledby="{uid}-tab-{selected.id}"
      tabindex="0"
    >
      {@render panel(selected)}
    </div>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .list {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .item {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--h-lg);
    border-bottom: 2px solid transparent;
    color: var(--muted);
  }
  .item.divider {
    margin-left: var(--sp-2);
    border-left: 1px solid var(--border);
  }
  .item.sel {
    color: var(--text);
    border-bottom-color: var(--ink);
  }
  .tab {
    height: 100%;
    padding: 0 var(--sp-8) 0 var(--sp-3);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--fs-sm);
    white-space: nowrap;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  .cl {
    position: absolute;
    right: var(--sp-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dot {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: var(--r-pill);
    background: var(--text);
    pointer-events: none;
  }
  .cl.dirty :global(button) {
    opacity: 0;
  }
  .item:hover .cl.dirty :global(button),
  .item:focus-within .cl.dirty :global(button) {
    opacity: 1;
  }
  .item:hover .dot,
  .item:focus-within .dot {
    display: none;
  }
  /* Styled like ShortcutSheet's group titles so a group reads as a label,
     not as one more item. */
  .heading {
    margin-top: var(--sp-4);
    padding: var(--sp-4) var(--sp-3) var(--sp-2);
    border-top: 1px solid var(--border);
    color: var(--text);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  /* A rule above every group but the first separates the groups. */
  .heading:first-child {
    margin-top: 0;
    padding-top: var(--sp-1);
    border-top: 0;
  }
  .vertical .list {
    flex-direction: column;
  }
  .vertical .item {
    height: var(--h-md);
    border-bottom: 0;
    border-left: 2px solid transparent;
  }
  .vertical .item.sel {
    border-left-color: var(--ink);
  }
  .vertical .tab {
    flex: 1;
    text-align: left;
  }
</style>
