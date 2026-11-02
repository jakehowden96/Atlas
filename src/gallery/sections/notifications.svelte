<script lang="ts">
  import GallerySection from "../GallerySection.svelte";
  import NotificationsPanel from "../../lib/components/ui/NotificationsPanel.svelte";
  import { notificationLog } from "../../lib/stores/toast";

  const long =
    "The worktree could not be removed because a file is open in another program. ".repeat(6);
  const now = Date.now();
  notificationLog.set([
    { id: "1", title: "Workspace added", type: "success", time: now - 3_600_000, read: true },
    {
      id: "2",
      title: "Rate limit close",
      body: "80% of the limit used",
      type: "warning",
      time: now - 600_000,
      read: false,
    },
    {
      id: "3",
      title: "Could not remove worktree",
      body: long,
      type: "error",
      time: now - 5_000,
      read: false,
    },
  ]);
</script>

<GallerySection title="Notifications panel" states={["empty", "mixed tones", "long body"]}>
  <NotificationsPanel />
</GallerySection>
