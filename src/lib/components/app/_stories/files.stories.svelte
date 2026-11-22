<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import FilesView from "../files/FilesView.svelte";
  import FileTree from "../files/FileTree.svelte";
  import FileEditor from "../files/FileEditor.svelte";
  import FileRail from "../files/FileRail.svelte";
  import OpenDialog from "../files/OpenDialog.svelte";
  import UnsavedDialog from "../files/UnsavedDialog.svelte";
  import CodeEditor from "../files/CodeEditor.svelte";
  import Tree, { type TreeItem } from "../files/Tree.svelte";
  import TreeRow from "../files/TreeRow.svelte";
  import { activeFile, closeRequest } from "$lib/stores/files";
  import { openFiles } from "$lib/stores/file-tabs";
  import { fileRailOpen, openDialogOpen } from "$lib/stores/view";
  import { BILLING, FILE_TEXT, OPEN_FILES, seedWorld, worldBackend } from "$lib/storybook/fixtures/world";

  const { Story } = defineMeta({
    title: "App/Files",
    parameters: { layout: "padded", backend: worldBackend },
  });

  const files = () => seedWorld("files");
  const full = "height: 100vh; display: flex";
  const nodes: TreeItem[] = [
    { id: "docs", label: "docs", kind: "folder", level: 1, expandable: true, expanded: true, parentId: null },
    { id: "docs/webhooks.md", label: "webhooks.md", kind: "md", level: 2, expandable: false, expanded: false, parentId: "docs", unsaved: true },
    { id: "docs/retries.md", label: "retries.md", kind: "md", level: 2, expandable: false, expanded: false, parentId: "docs" },
    { id: "src", label: "src", kind: "folder", level: 1, expandable: true, expanded: false, parentId: null },
    { id: "Cargo.toml", label: "Cargo.toml", kind: "data", level: 1, expandable: false, expanded: false, parentId: null },
  ];
</script>

<Story name="Screen" parameters={{ layout: "fullscreen" }} beforeEach={files}>
  {#snippet template()}<div style={full}><FilesView /></div>{/snippet}
</Story>

<Story name="Screen, nothing open" parameters={{ layout: "fullscreen" }} beforeEach={() => (files(), openFiles.set([]), activeFile.set(""))}>
  {#snippet template()}<div style={full}><FilesView /></div>{/snippet}
</Story>

<Story name="File tree" beforeEach={files}>
  {#snippet template()}<div style="width: 240px; height: 600px; display: flex; flex-direction: column"><FileTree /></div>{/snippet}
</Story>

<Story name="Editor" parameters={{ layout: "fullscreen" }} beforeEach={files}>
  {#snippet template()}<div style={full}><FileEditor /></div>{/snippet}
</Story>

<Story name="File rail" beforeEach={() => (files(), fileRailOpen.set(true))}>
  {#snippet template()}<div style="width: 220px; height: 600px; display: flex"><FileRail /></div>{/snippet}
</Story>

<Story name="Open dialog" parameters={{ layout: "fullscreen" }} beforeEach={() => (files(), openDialogOpen.set(true))}>
  {#snippet template()}<OpenDialog />{/snippet}
</Story>

<Story name="Unsaved changes" parameters={{ layout: "fullscreen" }} beforeEach={() => (files(), closeRequest.set({ kind: "tab", key: OPEN_FILES[0]! }))}>
  {#snippet template()}<UnsavedDialog />{/snippet}
</Story>

<Story name="Code editor" parameters={{ layout: "fullscreen" }}>
  {#snippet template()}
    <div style="height: 400px; display: flex">
      <CodeEditor docKey="retry" path="src/retry.rs" root={BILLING} text={FILE_TEXT[`${BILLING}/src/retry.rs`]!} onChange={() => {}} />
    </div>
  {/snippet}
</Story>

<Story name="Tree">
  {#snippet template()}<div style="width: 240px"><Tree {nodes} label="Billing docs" selectedId="docs/retries.md" /></div>{/snippet}
</Story>

<Story name="Tree rows">
  {#snippet template()}
    <div role="tree" aria-label="Rows" style="width: 240px">
      <TreeRow id="a" label="docs" level={1} kind="folder" expandable expanded tabindex={0} />
      <TreeRow id="b" label="webhooks.md" level={2} kind="md" selected unsaved tabindex={-1} />
      <TreeRow id="c" label="retry.rs" level={2} kind="source" tabindex={-1} />
      <TreeRow id="d" label="Cargo.toml" level={1} kind="data" tabindex={-1} />
    </div>
  {/snippet}
</Story>
