<script lang="ts">
  import Toast from "../Toast.svelte";
  import JumpPalette from "../session/JumpPalette.svelte";
  import NewSessionModal from "../session/NewSessionModal.svelte";
  import SettingsModal from "../settings/SettingsModal.svelte";
  import ShortcutSheet from "../settings/ShortcutSheet.svelte";
  import DropTarget from "../ui/DropTarget.svelte";
  import ErrorBoundary from "../ui/ErrorBoundary.svelte";
</script>

<ErrorBoundary name="New session"><NewSessionModal /></ErrorBoundary>
<ErrorBoundary name="Jump palette"><JumpPalette /></ErrorBoundary>
<ErrorBoundary name="Settings"><SettingsModal /></ErrorBoundary>
<ErrorBoundary name="Keyboard shortcuts"><ShortcutSheet /></ErrorBoundary>
<ErrorBoundary name="Notifications"><Toast /></ErrorBoundary>
<ErrorBoundary name="Drop target"><DropTarget /></ErrorBoundary>
