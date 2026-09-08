<!-- The three-column Files screen: tree (240px) · editor (flex) · rail (240px).
     Phase 02 builds the tree; phase 03 fills the editor column and phase 04
     adds the rail. -->
<script lang="ts">
  import FileTree from "./FileTree.svelte";
</script>

<div class="files">
  <FileTree />
  <div class="editor">
    <p class="stub">Select a file</p>
  </div>
</div>

<style>
  .files {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .editor {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }

  .stub {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }
</style>
