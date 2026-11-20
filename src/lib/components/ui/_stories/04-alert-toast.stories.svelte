<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import * as Alert from "../alert/index.js";
  import { Toaster } from "../sonner/index.js";
  import { Button } from "../button/index.js";
  import Icon from "../icon/icon.svelte";
  import { showToast } from "$lib/stores/toast";

  const { Story } = defineMeta({ title: "UI/Alert, Sonner", tags: ["autodocs"] });

  function seed() {
    showToast("Pushed 3 commits to feat/rail-v6", { type: "success" });
    showToast("GitHub token expires in 3 days", {
      type: "warning",
      body: "Re-link it in Settings → Connectors.",
    });
    showToast("Couldn't start the session", {
      type: "error",
      body: "claude exited with code 1 before the first prompt.",
      action: { label: "Retry", run: () => {} },
    });
    showToast("Linear is syncing", { type: "info" });
  }
</script>

<Story name="Alert" asChild>
  <div class="grid max-w-[560px] gap-3">
    <Alert.Root>
      <Icon name="info" />
      <Alert.Title>Claude Code 2.4 is available</Alert.Title>
      <Alert.Description
        >Restart sessions to pick it up. Running sessions keep their version.</Alert.Description
      >
    </Alert.Root>
    <Alert.Root variant="success">
      <Icon name="check_circle" />
      <Alert.Title>GitHub linked</Alert.Title>
      <Alert.Description
        >Pull requests for 4 watched repositories will appear here.</Alert.Description
      >
    </Alert.Root>
    <Alert.Root variant="warning">
      <Icon name="warning" />
      <Alert.Title>Token expires in 3 days</Alert.Title>
      <Alert.Description>Re-link before then to keep pull requests updating.</Alert.Description>
      <Alert.Action><Button size="sm" variant="outline">Re-link</Button></Alert.Action>
    </Alert.Root>
    <Alert.Root variant="destructive">
      <Icon name="error" />
      <Alert.Title>Couldn't load pull requests</Alert.Title>
      <Alert.Description>gh returned 401. Sign in again to continue.</Alert.Description>
      <Alert.Action
        ><Button size="sm" variant="outline"><Icon name="refresh" />Retry</Button></Alert.Action
      >
    </Alert.Root>
    <Alert.Root layout="inline">
      <Icon name="info" />
      <Alert.Title>Inline: one line, centred.</Alert.Title>
    </Alert.Root>
  </div>
</Story>

<Story name="Sonner (toasts)" asChild>
  <div class="grid h-[420px] content-start gap-3">
    <Button variant="outline" onclick={seed}>Show toasts</Button>
    <p class="text-caption text-muted-foreground">
      shadcn Sonner, bottom-right, 340px, three visible. Errors persist; info and success go after
      5s, warnings and action toasts after 8s; hover pauses. Every toast also lands in the
      Notifications log.
    </p>
    <Toaster />
  </div>
</Story>
