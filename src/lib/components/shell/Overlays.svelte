<script lang="ts">
  import { Toaster } from "../ui/sonner/index.js";
  import JumpPalette from "../session/JumpPalette.svelte";
  import NewSessionModal from "../session/NewSessionModal.svelte";
  import SettingsModal from "../settings/SettingsModal.svelte";
  import ShortcutSheet from "../settings/ShortcutSheet.svelte";
  import DropTarget from "../app/shell/DropTarget.svelte";
  import ErrorBoundary from "../app/shell/ErrorBoundary.svelte";
</script>

<ErrorBoundary name="New session"><NewSessionModal /></ErrorBoundary>
<ErrorBoundary name="Jump palette"><JumpPalette /></ErrorBoundary>
<ErrorBoundary name="Settings"><SettingsModal /></ErrorBoundary>
<ErrorBoundary name="Keyboard shortcuts"><ShortcutSheet /></ErrorBoundary>
<ErrorBoundary name="Notifications"><Toaster /></ErrorBoundary>
<ErrorBoundary name="Drop target"><DropTarget /></ErrorBoundary>
