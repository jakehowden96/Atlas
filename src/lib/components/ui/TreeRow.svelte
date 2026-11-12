<script module lang="ts">
  export type TreeKind = "folder" | "md" | "source" | "data";
</script>

<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";

  interface Props {
    id: string;
    label: string;
    level: number;
    kind: TreeKind;
    expandable?: boolean;
    expanded?: boolean;
    selected?: boolean;
    tabindex: 0 | -1;
    /** Unsaved-changes dot. */
    unsaved?: boolean;
  }

  let {
    id,
    label,
    level,
    kind,
    expandable = false,
    expanded = false,
    selected = false,
    tabindex,
    unsaved = false,
  }: Props = $props();

  // shortcut: folder_open is not in the subset icon font, so open folders keep `folder`; add the glyph to icon-names.txt to upgrade.
  const icon: IconName = $derived(
    kind === "folder"
      ? "folder"
      : kind === "md"
        ? "article"
        : kind === "data"
          ? "data_object"
          : "code",
  );
</script>

<div
  class="row focus-inset"
  class:selected
  role="treeitem"
  data-id={id}
  aria-level={level}
  aria-expanded={expandable ? expanded : undefined}
  aria-selected={selected}
  {tabindex}
  style:padding-left="calc({level - 1} * 20px + var(--sp-2))"
>
  <span
    class="twisty"
    class:open={expanded}
    class:hidden={!expandable}
    aria-hidden="true"
    data-twisty><Icon name="chevron_right" /></span
  >
  <Icon name={icon} />
  <span class="label">{label}</span>
  {#if unsaved}<span class="dot" role="img" aria-label="Unsaved changes"></span>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    height: var(--h-md);
    padding-right: var(--sp-2);
    border-radius: var(--r-md);
    color: var(--text);
    font-size: var(--fs-md);
    cursor: pointer;
    user-select: none;
  }
  .row:hover {
    background: var(--surface2);
  }
  .row.selected {
    background: var(--surface3);
    font-weight: var(--fw-semi);
  }
  .twisty {
    display: inline-flex;
    color: var(--muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  .twisty.hidden {
    visibility: hidden;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: var(--sp-2);
    height: var(--sp-2);
    border-radius: var(--r-pill);
    background: var(--warn);
    flex: none;
  }
</style>
