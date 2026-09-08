<!-- The three-column Files screen: tree (240px) · editor (flex) · rail (240px).
     Phase 02 builds the tree, phase 03 the editor; phase 04 adds the rail. -->
<script lang="ts">
  import FileEditor from "./FileEditor.svelte";
  import FileTree from "./FileTree.svelte";
</script>

<div class="files">
  <FileTree />
  <FileEditor />
</div>

<style>
  .files {
    display: flex;
    flex: 1;
    min-height: 0;
  }
</style>
