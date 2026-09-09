<!-- The three-column Files screen: tree (240px) · editor (flex) · rail (240px). -->
<script lang="ts">
  import FileEditor from "./FileEditor.svelte";
  import FileRail from "./FileRail.svelte";
  import FileTree from "./FileTree.svelte";
  import OpenDialog from "./OpenDialog.svelte";
</script>

<div class="files">
  <FileTree />
  <FileEditor />
  <FileRail />
</div>

<OpenDialog />

<style>
  .files {
    display: flex;
    flex: 1;
    min-height: 0;
  }
</style>
