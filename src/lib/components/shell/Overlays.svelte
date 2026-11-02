<script lang="ts">
  import Toast from "../Toast.svelte";
  import JumpPalette from "../session/JumpPalette.svelte";
  import NewSessionModal from "../session/NewSessionModal.svelte";
  import SettingsModal from "../settings/SettingsModal.svelte";
  import ShortcutSheet from "../settings/ShortcutSheet.svelte";
  import DropTarget from "../ui/DropTarget.svelte";
</script>

<NewSessionModal />
<JumpPalette />
<SettingsModal />
<ShortcutSheet />
<Toast />
<DropTarget />
