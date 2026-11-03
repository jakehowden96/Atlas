<script module lang="ts">
  import type { TreeKind } from "./TreeRow.svelte";
  import type { TreeNode } from "../../ui/tree-nav";

  export interface TreeItem extends TreeNode {
    label: string;
    kind: TreeKind;
    unsaved?: boolean;
    /** Draws the `editor` snippet in place of the row (inline rename, new folder). */
    editing?: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import TreeRow from "./TreeRow.svelte";
  import { navigate, typeahead } from "../../ui/tree-nav";

  interface Props {
    /** Flat list of visible nodes. The parent owns expansion and selection. */
    nodes: TreeItem[];
    label: string;
    selectedId?: string | null;
    onopen?: (id: string) => void;
    ontoggle?: (id: string, expand: boolean) => void;
    oncontextmenu?: (id: string) => void;
    onrename?: (id: string) => void;
    ondelete?: (id: string) => void;
    editor?: Snippet<[TreeItem]>;
  }

  let {
    nodes,
    label,
    selectedId = null,
    onopen,
    ontoggle,
    oncontextmenu,
    onrename,
    ondelete,
    editor,
  }: Props = $props();

  let focusId = $state<string | null>(null);
  let root: HTMLElement;
  let buffer = "";
  let bufferTimer: ReturnType<typeof setTimeout> | undefined;

  // Single tab stop: the focused node, else the selected one, else the first.
  const tabId = $derived(
    [focusId, selectedId].find((id) => id && nodes.some((n) => n.id === id)) ?? nodes[0]?.id,
  );

  const idOf = (t: EventTarget | null) =>
    (t as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;

  function focusNode(id: string) {
    focusId = id;
    root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    const id = idOf(e.target);
    if (!id || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") onopen?.(id);
    else if (e.key === "F2") onrename?.(id);
    else if (e.key === "Delete") ondelete?.(id);
    else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) oncontextmenu?.(id);
    else if (e.key.length === 1 && e.key !== " ") {
      clearTimeout(bufferTimer);
      buffer += e.key;
      bufferTimer = setTimeout(() => (buffer = ""), 700);
      const hit = typeahead(nodes, id, buffer);
      if (hit) focusNode(hit);
    } else {
      const r = navigate(nodes, id, e.key);
      if (!r) return;
      if (r.toggle) ontoggle?.(r.toggle.id, r.toggle.expand);
      if (r.focusId !== id) focusNode(r.focusId);
    }
    e.preventDefault();
  }
</script>

<div
  bind:this={root}
  role="tree"
  aria-label={label}
  tabindex="-1"
  {onkeydown}
  onfocusin={(e) => {
    const id = idOf(e.target);
    if (id) focusId = id;
  }}
  oncontextmenu={(e) => {
    const id = idOf(e.target);
    if (id) {
      e.preventDefault();
      oncontextmenu?.(id);
    }
  }}
>
  {#each nodes as n (n.id)}
    {#if n.editing && editor}
      <div style:padding-left="calc({n.level - 1} * 20px + var(--sp-2))">{@render editor(n)}</div>
    {:else}
      <TreeRow
        id={n.id}
        label={n.label}
        level={n.level}
        kind={n.kind}
        expandable={n.expandable}
        expanded={n.expanded}
        selected={n.id === selectedId}
        unsaved={n.unsaved}
        tabindex={n.id === tabId ? 0 : -1}
        onclick={() => {
          focusNode(n.id);
          onopen?.(n.id);
        }}
        ontwisty={() => ontoggle?.(n.id, !n.expanded)}
      />
    {/if}
  {/each}
</div>
