<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import ListRow from "../../lib/components/ui/ListRow.svelte";
  import Tree, { type TreeItem } from "../../lib/components/ui/Tree.svelte";

  type Src = Omit<TreeItem, "expanded" | "level">;
  const tree: Src[] = [
    { id: "src", parentId: null, expandable: true, label: "src", kind: "folder" },
    { id: "lib", parentId: "src", expandable: true, label: "lib", kind: "folder" },
    {
      id: "app",
      parentId: "lib",
      expandable: false,
      label: "app.ts",
      kind: "source",
      unsaved: true,
    },
    { id: "cfg", parentId: "lib", expandable: false, label: "config.toml", kind: "data" },
    { id: "docs", parentId: "src", expandable: true, label: "docs", kind: "folder" },
    { id: "readme", parentId: null, expandable: false, label: "README.md", kind: "md" },
  ];
  let open = $state(new Set(["src", "lib"]));
  let selectedId = $state<string | null>("app");

  const visible = $derived.by(() => {
    const out: TreeItem[] = [];
    const walk = (parentId: string | null, level: number) => {
      for (const n of tree.filter((t) => t.parentId === parentId)) {
        out.push({ ...n, level, expanded: open.has(n.id) });
        if (open.has(n.id)) walk(n.id, level + 1);
      }
    };
    walk(null, 1);
    return out;
  });

  function toggle(id: string, expand: boolean) {
    const next = new Set(open);
    if (expand) next.add(id);
    else next.delete(id);
    open = next;
  }

  let picked = $state("Beta");
</script>

<GallerySection
  title="List row and tree"
  states={["rest", "hover", "selected", "focused", "disabled", "unsaved"]}
>
  <div class="cols">
    <div class="box">
      <Tree
        nodes={visible}
        label="Sample files"
        {selectedId}
        onopen={(id) => (selectedId = id)}
        ontoggle={toggle}
      />
    </div>
    <div class="box" role="listbox" aria-label="Sample list">
      {#each ["Alpha", "Beta", "Gamma"] as name (name)}
        <ListRow option selected={picked === name} onclick={() => (picked = name)}>
          {#snippet children()}{name}{/snippet}
          {#snippet actions()}<span class="hint">Rename</span>{/snippet}
        </ListRow>
      {/each}
      <ListRow option disabled>
        {#snippet children()}Delta (disabled){/snippet}
      </ListRow>
    </div>
  </div>
</GallerySection>

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-5);
  }
  .box {
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: var(--sp-2);
  }
  .hint {
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
