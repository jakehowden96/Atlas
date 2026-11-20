<script lang="ts">
  import { Toaster } from "../../ui/sonner/index.js";
  import JumpPalette from "../session/JumpPalette.svelte";
  import NewSessionModal from "../session/NewSessionModal.svelte";
  import SettingsDialog from "../settings/SettingsDialog.svelte";
  import ShortcutSheet from "../settings/ShortcutSheet.svelte";
  import DropTarget from "./DropTarget.svelte";
  import ErrorBoundary from "./ErrorBoundary.svelte";
</script>

<ErrorBoundary name="New session"><NewSessionModal /></ErrorBoundary>
<ErrorBoundary name="Jump palette"><JumpPalette /></ErrorBoundary>
<ErrorBoundary name="Settings"><SettingsDialog /></ErrorBoundary>
<ErrorBoundary name="Keyboard shortcuts"><ShortcutSheet /></ErrorBoundary>
<ErrorBoundary name="Notifications"><Toaster /></ErrorBoundary>
<ErrorBoundary name="Drop target"><DropTarget /></ErrorBoundary>
